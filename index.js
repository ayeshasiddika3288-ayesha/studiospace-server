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