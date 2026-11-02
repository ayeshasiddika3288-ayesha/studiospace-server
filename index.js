require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("studiospace");
    const studiosCollection = db.collection("studios");

    // GET all studios (filter, search, sort, limit)
    app.get("/api/studios", async (req, res) => {
      const { category, search, ownerEmail, sort, limit } = req.query;
      const query = {};
      if (category) query.category = category;
      if (ownerEmail) query.ownerEmail = ownerEmail;
      if (search) query.title = { $regex: search, $options: "i" };

      let cursor = studiosCollection.find(query);
      if (sort === "rating") cursor = cursor.sort({ rating: -1 });
      else cursor = cursor.sort({ createdAt: -1 });
      if (limit) cursor = cursor.limit(Number(limit));

      res.send(await cursor.toArray());
    });

    // GET single studio
    app.get("/api/studios/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).send({ message: "Invalid studio id" });
      }
      const studio = await studiosCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      if (!studio) return res.status(404).send({ message: "Studio not found" });
      res.send(studio);
    });

    // POST add studio
    app.post("/api/studios", async (req, res) => {
      const studio = {
        ...req.body,
        rating: 0,
        createdAt: new Date(),
      };
      const result = await studiosCollection.insertOne(studio);
      res.send(result);
    });

    // PUT update studio
    app.put("/api/studios/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).send({ message: "Invalid studio id" });
      }
      const { _id, ...updatedData } = req.body;
      const result = await studiosCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: updatedData }
      );
      res.send(result);
    });

    // DELETE studio
    app.delete("/api/studios/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).send({ message: "Invalid studio id" });
      }
      const result = await studiosCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });

        const bookingsCollection = db.collection("bookings");

    const toMinutes = (t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };

    // POST create booking (status: Pending)
    app.post("/api/bookings", async (req, res) => {
      const { studioId, date, startTime, endTime, userEmail, userName } = req.body;

      if (!ObjectId.isValid(studioId)) {
        return res.status(400).send({ message: "Invalid studio id" });
      }
      if (!date || !startTime || !endTime || !userEmail) {
        return res.status(400).send({ message: "All booking fields are required" });
      }
      if (startTime >= endTime) {
        return res.status(400).send({ message: "End time must be after start time" });
      }
      if (date < new Date().toISOString().slice(0, 10)) {
        return res.status(400).send({ message: "You cannot book a past date" });
      }

      const studio = await studiosCollection.findOne({ _id: new ObjectId(studioId) });
      if (!studio) return res.status(404).send({ message: "Studio not found" });
      if (studio.ownerEmail === userEmail) {
        return res.status(400).send({ message: "You cannot book your own studio" });
      }

      // Challenge 2: overlap check against Confirmed bookings
      const clash = await bookingsCollection.findOne({
        studioId,
        date,
        status: "Confirmed",
        startTime: { $lt: endTime },
        endTime: { $gt: startTime },
      });
      if (clash) {
        return res.status(409).send({
          message: `This studio is already booked from ${clash.startTime} to ${clash.endTime} on that date. Please pick another slot.`,
        });
      }

      const hours = (toMinutes(endTime) - toMinutes(startTime)) / 60;
      const booking = {
        studioId,
        studioTitle: studio.title,
        studioImage: studio.image,
        hostEmail: studio.ownerEmail,
        userEmail,
        userName,
        date,
        startTime,
        endTime,
        hours,
        totalPrice: hours * studio.hourlyRate,
        status: "Pending",
        createdAt: new Date(),
      };
      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    // GET bookings by user (guest) or host
    app.get("/api/bookings", async (req, res) => {
      const { userEmail, hostEmail } = req.query;
      if (!userEmail && !hostEmail) {
        return res.status(400).send({ message: "userEmail or hostEmail is required" });
      }
      const query = {};
      if (userEmail) query.userEmail = userEmail;
      if (hostEmail) query.hostEmail = hostEmail;
      res.send(await bookingsCollection.find(query).sort({ createdAt: -1 }).toArray());
    });

    // PATCH cancel a pending booking
    app.patch("/api/bookings/:id/cancel", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).send({ message: "Invalid booking id" });
      }
      const result = await bookingsCollection.updateOne(
        { _id: new ObjectId(req.params.id), status: "Pending" },
        { $set: { status: "Cancelled" } }
      );
      if (result.modifiedCount === 0) {
        return res.status(400).send({ message: "Only pending bookings can be cancelled" });
      }
      res.send(result);
    });

    // PATCH host updates booking status
    app.patch("/api/bookings/:id/status", async (req, res) => {
      const { status } = req.body;
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).send({ message: "Invalid booking id" });
      }
      if (!["Confirmed", "Completed"].includes(status)) {
        return res.status(400).send({ message: "Invalid status" });
      }
      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      if (!booking) return res.status(404).send({ message: "Booking not found" });

      if (status === "Confirmed") {
        const clash = await bookingsCollection.findOne({
          _id: { $ne: booking._id },
          studioId: booking.studioId,
          date: booking.date,
          status: "Confirmed",
          startTime: { $lt: booking.endTime },
          endTime: { $gt: booking.startTime },
        });
        if (clash) {
          return res.status(409).send({
            message: "Another confirmed booking already overlaps this slot.",
          });
        }
      }
      const result = await bookingsCollection.updateOne(
        { _id: booking._id },
        { $set: { status } }
      );
      res.send(result);
    });

    console.log("MongoDB connected");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
  }
}
run();

app.get("/", (req, res) => {
  res.send("StudioSpace server is running");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});