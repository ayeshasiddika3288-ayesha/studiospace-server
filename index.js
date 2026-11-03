require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === "production";

app.use(
  cors({
    origin: (process.env.CLIENT_URL || "").replace(/\/$/, ""),
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// wait until MongoDB is connected (needed for Vercel serverless)
let ready;
app.use(async (req, res, next) => {
  await ready;
  next();
});

const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// Challenge 1: JWT verification middleware (reads HTTPOnly cookie)
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized: please login first" });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ message: "Unauthorized: invalid or expired token" });
    }
    req.user = decoded;
    next();
  });
};

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const toMinutes = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

async function run() {
  try {
    await client.connect();
    const db = client.db("studiospace");
    const studiosCollection = db.collection("studios");
    const bookingsCollection = db.collection("bookings");

    // ---------- Auth cookie ----------
    app.post("/api/jwt", (req, res) => {
      const { token } = req.body;
      if (!token) return res.status(400).send({ message: "Token is required" });
      jwt.verify(token, process.env.JWT_SECRET, (err) => {
        if (err) return res.status(401).send({ message: "Invalid token" });
        res.cookie("token", token, cookieOptions).send({ success: true });
      });
    });

    app.post("/api/logout", (req, res) => {
      res
        .clearCookie("token", { ...cookieOptions, maxAge: undefined })
        .send({ success: true });
    });

    // ---------- Studios ----------
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

    app.post("/api/studios", verifyToken, async (req, res) => {
      const studio = {
        ...req.body,
        ownerEmail: req.user.email,
        ownerName: req.body.ownerName || req.user.name,
        rating: 0,
        createdAt: new Date(),
      };
      const result = await studiosCollection.insertOne(studio);
      res.send(result);
    });

    app.put("/api/studios/:id", verifyToken, async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).send({ message: "Invalid studio id" });
      }
      const studio = await studiosCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      if (!studio) return res.status(404).send({ message: "Studio not found" });
      if (studio.ownerEmail !== req.user.email) {
        return res.status(403).send({ message: "You can only edit your own studio" });
      }
      // eslint-disable-next-line no-unused-vars
      const { _id, ownerEmail, ownerName, rating, createdAt, ...updatedData } =
        req.body;
      const result = await studiosCollection.updateOne(
        { _id: studio._id },
        { $set: updatedData }
      );
      res.send(result);
    });

    app.delete("/api/studios/:id", verifyToken, async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).send({ message: "Invalid studio id" });
      }
      const studio = await studiosCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      if (!studio) return res.status(404).send({ message: "Studio not found" });
      if (studio.ownerEmail !== req.user.email) {
        return res
          .status(403)
          .send({ message: "You can only delete your own studio" });
      }
      const result = await studiosCollection.deleteOne({ _id: studio._id });
      res.send(result);
    });

    // ---------- Bookings ----------
    app.post("/api/bookings", verifyToken, async (req, res) => {
      const { studioId, date, startTime, endTime, userName } = req.body;
      const userEmail = req.user.email;

      if (!ObjectId.isValid(studioId)) {
        return res.status(400).send({ message: "Invalid studio id" });
      }
      if (!date || !startTime || !endTime) {
        return res.status(400).send({ message: "All booking fields are required" });
      }
      if (startTime >= endTime) {
        return res.status(400).send({ message: "End time must be after start time" });
      }
      if (date < new Date().toISOString().slice(0, 10)) {
        return res.status(400).send({ message: "You cannot book a past date" });
      }

      const studio = await studiosCollection.findOne({
        _id: new ObjectId(studioId),
      });
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

            const hours = Math.round(((toMinutes(endTime) - toMinutes(startTime)) / 60) * 100) / 100;

      const booking = {
        studioId,
        studioTitle: studio.title,
        studioImage: studio.image,
        hostEmail: studio.ownerEmail,
        userEmail,
        userName: userName || req.user.name,
        date,
        startTime,
        endTime,
        hours,
        totalPrice: Math.round(hours * studio.hourlyRate * 100) / 100,
        status: "Pending",
        createdAt: new Date(),
      };
      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    app.get("/api/bookings", async (req, res) => {
      const { userEmail, hostEmail } = req.query;
      if (!userEmail && !hostEmail) {
        return res
          .status(400)
          .send({ message: "userEmail or hostEmail is required" });
      }
      const query = {};
      if (userEmail) query.userEmail = userEmail;
      if (hostEmail) query.hostEmail = hostEmail;
      res.send(
        await bookingsCollection.find(query).sort({ createdAt: -1 }).toArray()
      );
    });

    app.patch("/api/bookings/:id/cancel", verifyToken, async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).send({ message: "Invalid booking id" });
      }
      const result = await bookingsCollection.updateOne(
        {
          _id: new ObjectId(req.params.id),
          userEmail: req.user.email,
          status: "Pending",
        },
        { $set: { status: "Cancelled" } }
      );
      if (result.modifiedCount === 0) {
        return res
          .status(400)
          .send({ message: "Only your pending bookings can be cancelled" });
      }
      res.send(result);
    });

    app.patch("/api/bookings/:id/status", verifyToken, async (req, res) => {
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
      if (booking.hostEmail !== req.user.email) {
        return res
          .status(403)
          .send({ message: "Only the studio host can update this booking" });
      }

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
ready = run();

app.get("/", (req, res) => {
  res.send("StudioSpace server is running");
});

if (!isProd) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;