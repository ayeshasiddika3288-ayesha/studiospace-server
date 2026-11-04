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

const toMinutes = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

// Lazy MongoDB connection that retries on the next request if it fails
let dbPromise = null;
const getDb = () => {
  if (!dbPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 5,
    });
    dbPromise = client
      .connect()
      .then(() => client.db("studiospace"))
      .catch(async (err) => {
        dbPromise = null;
        try {
          await client.close();
        } catch {}
        throw err;
      });
  }
  return dbPromise;
};

// ---------- Routes that do not need the database ----------
app.get("/", (req, res) => {
  res.send({
    message: "StudioSpace server is running",
    endpoints: {
      studios: "/api/studios",
      studiosFeatured: "/api/studios?limit=6",
      studiosByCategory: "/api/studios?category=Photo%20Studio",
      studioById: "/api/studios/:id",
      bookingsByGuest: "/api/bookings?userEmail=<email>",
      bookingsByHost: "/api/bookings?hostEmail=<email>",
    },
  });
});

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

// ---------- Database connection for everything below ----------
app.use(async (req, res, next) => {
  try {
    const db = await getDb();
    req.studios = db.collection("studios");
    req.bookings = db.collection("bookings");
    req.reviews = db.collection("reviews");
    next();
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    res
      .status(503)
      .send({ message: "Database is waking up, please try again in a moment" });
  }
});

// ---------- Studios ----------
app.get("/api/studios", async (req, res) => {
  const { category, search, ownerEmail, sort, limit } = req.query;
  const query = {};
  if (category) query.category = category;
  if (ownerEmail) query.ownerEmail = ownerEmail;
  if (search) {
    const safeSearch = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.title = { $regex: safeSearch, $options: "i" };
  }

  let cursor = req.studios.find(query);
  if (sort === "rating") cursor = cursor.sort({ rating: -1 });
  else cursor = cursor.sort({ createdAt: -1 });
  if (limit) cursor = cursor.limit(Number(limit));

  res.send(await cursor.toArray());
});

app.get("/api/studios/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send({ message: "Invalid studio id" });
  }
  const studio = await req.studios.findOne({ _id: new ObjectId(req.params.id) });
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
  const result = await req.studios.insertOne(studio);
  res.send(result);
});

app.put("/api/studios/:id", verifyToken, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send({ message: "Invalid studio id" });
  }
  const studio = await req.studios.findOne({ _id: new ObjectId(req.params.id) });
  if (!studio) return res.status(404).send({ message: "Studio not found" });
  if (studio.ownerEmail !== req.user.email) {
    return res.status(403).send({ message: "You can only edit your own studio" });
  }
  // eslint-disable-next-line no-unused-vars
  const { _id, ownerEmail, ownerName, rating, createdAt, ...updatedData } =
    req.body;
  const result = await req.studios.updateOne(
    { _id: studio._id },
    { $set: updatedData }
  );
  res.send(result);
});

app.delete("/api/studios/:id", verifyToken, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send({ message: "Invalid studio id" });
  }
  const studio = await req.studios.findOne({ _id: new ObjectId(req.params.id) });
  if (!studio) return res.status(404).send({ message: "Studio not found" });
  if (studio.ownerEmail !== req.user.email) {
    return res
      .status(403)
      .send({ message: "You can only delete your own studio" });
  }
  const result = await req.studios.deleteOne({ _id: studio._id });
  res.send(result);
});

// ---------- Reviews ----------
app.get("/api/studios/:id/reviews", async (req, res) => {
  const reviews = await req.reviews
    .find({ studioId: req.params.id })
    .sort({ createdAt: -1 })
    .toArray();
  res.send(reviews);
});

app.post("/api/studios/:id/reviews", verifyToken, async (req, res) => {
  const { id } = req.params;
  const rating = Number(req.body.rating);
  const comment = String(req.body.comment || "").trim();

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid studio id" });
  }
  if (!(rating >= 1 && rating <= 5) || !comment) {
    return res
      .status(400)
      .send({ message: "Rating (1-5) and comment are required" });
  }

  const booked = await req.bookings.findOne({
    studioId: id,
    userEmail: req.user.email,
    status: { $in: ["Confirmed", "Completed"] },
  });
  if (!booked) {
    return res
      .status(403)
      .send({ message: "Only guests with a confirmed booking can review" });
  }
  const already = await req.reviews.findOne({
    studioId: id,
    userEmail: req.user.email,
  });
  if (already) {
    return res
      .status(409)
      .send({ message: "You already reviewed this studio" });
  }

  await req.reviews.insertOne({
    studioId: id,
    userEmail: req.user.email,
    userName: req.user.name,
    rating,
    comment,
    createdAt: new Date(),
  });

  const [stats] = await req.reviews
    .aggregate([
      { $match: { studioId: id } },
      { $group: { _id: null, avg: { $avg: "$rating" } } },
    ])
    .toArray();
  const avg = Math.round(stats.avg * 10) / 10;
  await req.studios.updateOne(
    { _id: new ObjectId(id) },
    { $set: { rating: avg } }
  );
  res.send({ success: true, rating: avg });
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

  const studio = await req.studios.findOne({ _id: new ObjectId(studioId) });
  if (!studio) return res.status(404).send({ message: "Studio not found" });
  if (studio.ownerEmail === userEmail) {
    return res.status(400).send({ message: "You cannot book your own studio" });
  }

  // Challenge 2: overlap check against Confirmed bookings
  const clash = await req.bookings.findOne({
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

  const hours =
    Math.round(((toMinutes(endTime) - toMinutes(startTime)) / 60) * 100) / 100;
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
  const result = await req.bookings.insertOne(booking);
  res.send(result);
});

app.get("/api/bookings", verifyToken, async (req, res) => {
  const { userEmail, hostEmail } = req.query;
  const me = req.user.email;
  if (!userEmail && !hostEmail) {
    return res
      .status(400)
      .send({ message: "userEmail or hostEmail is required" });
  }
  if ((userEmail && userEmail !== me) || (hostEmail && hostEmail !== me)) {
    return res
      .status(403)
      .send({ message: "You can only view your own bookings" });
  }
  const query = {};
  if (userEmail) query.userEmail = userEmail;
  if (hostEmail) query.hostEmail = hostEmail;
  res.send(await req.bookings.find(query).sort({ createdAt: -1 }).toArray());
});

app.patch("/api/bookings/:id/cancel", verifyToken, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send({ message: "Invalid booking id" });
  }
  const result = await req.bookings.updateOne(
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
  const booking = await req.bookings.findOne({
    _id: new ObjectId(req.params.id),
  });
  if (!booking) return res.status(404).send({ message: "Booking not found" });
  if (booking.hostEmail !== req.user.email) {
    return res
      .status(403)
      .send({ message: "Only the studio host can update this booking" });
  }

  if (status === "Confirmed") {
    const clash = await req.bookings.findOne({
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
  const result = await req.bookings.updateOne(
    { _id: booking._id },
    { $set: { status } }
  );
  res.send(result);
});

if (!isProd) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;