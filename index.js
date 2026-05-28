const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

//firebase
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middleware
app.use(cors());
app.use(express.json());

const verifyWithFirebase = async (req, res, next) => {
  if (!req.headers.authorization)
    return res.status(401).send({ message: "unauthorized access" });

  const authToken = req.headers.authorization.split(" ")[1];
  if (!authToken)
    return res.status(401).send({ message: "unauthorized access" });

  try {
    const userInfo = await admin.auth().verifyIdToken(authToken);
    req.token_email = userInfo.email;
    next();
  } catch {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@ai-inventory.u02f5oq.mongodb.net/?appName=AI-inventory`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("aiInventoryDB");
    const modelCollection = db.collection("models");
    const purchaseInfoCollection = db.collection("purchase_info");

    // get all models
    app.get("/models", async (req, res) => {
      const framework = req.query.framework;
      const search = req.query.search;

      let query = {};

      // framework filter
      if (framework) {
        query.framework = framework;
      }

      // search filter
      if (search) {
        query.name = {
          $regex: search,
          $options: "i",
        };
      }

      const result = await modelCollection.find(query).toArray();

      res.send(result);
    });

    //get single model data
    app.get("/model/:id", verifyWithFirebase, async (req, res) => {
      const id = req.params.id;
      const result = await modelCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // purchase a model
    app.post("/purchase/:id", verifyWithFirebase, async (req, res) => {
      try {
        const id = req.params.id;
        const user = req.token_email;

        const filter = { _id: new ObjectId(id) };

        // 1. Increase purchase count
        const updateResult = await modelCollection.updateOne(filter, {
          $inc: { purchased: 1 },
        });

        if (updateResult.modifiedCount === 0) {
          return res.status(404).send({
            message: "Model not found",
          });
        }

        // 2. Add purchase history
        const purchaseData = {
          modelId: new ObjectId(id),
          buyerEmail: user,
          purchasedAt: new Date(),
        };

        await purchaseInfoCollection.insertOne(purchaseData);

        return res.send({
          success: true,
          message: "Model purchased successfully",
        });
      } catch (error) {
        console.log(error);

        return res.status(500).send({
          message: "Purchase failed",
        });
      }
    });

    // get my model
    app.get("/my-models", verifyWithFirebase, async (req, res) => {
      const email = req.query.email;
      if (email != req.token_email)
        return res.status(403).send({ message: "forbidden access" });
      const result = await modelCollection
        .find({ createdBy: req.token_email })
        .toArray();
      res.send(result);
    });

    // get my purchases
    app.get("/my-purchases", verifyWithFirebase, async (req, res) => {
      const email = req.query.email;

      if (email !== req.token_email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const result = await purchaseInfoCollection
        .aggregate([
          {
            $match: {
              buyerEmail: req.token_email,
            },
          },
          {
            $lookup: {
              from: "models",
              localField: "modelId",
              foreignField: "_id",
              as: "modelInfo",
            },
          },
          {
            $unwind: "$modelInfo",
          },
        ])
        .toArray();

      res.send(result);
    });

    // add a model
    app.post("/add-model", verifyWithFirebase, async (req, res) => {
      const modelData = req.body;
      if (modelData.createdBy != req.token_email)
        return res.status(403).send({ message: "forbidden access" });
      const result = await modelCollection.insertOne(modelData);
      res.send(result);
    });

    // update a model
    app.patch("/update-model/:id", verifyWithFirebase, async (req, res) => {
      const id = req.params.id;

      const filter = {
        _id: new ObjectId(id),
      };

      const updateDoc = {
        $set: req.body,
      };

      const result = await modelCollection.updateOne(filter, updateDoc);

      res.send(result);
    });

    // delete a model
    app.delete("/model/:id", verifyWithFirebase, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id), createdBy: req.token_email };
      const result = await modelCollection.deleteOne(filter);
      res.send(result);
    });

    //update a model
    app.put("/model/:id", verifyWithFirebase, async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      if (updatedData.createdBy != req.token_email)
        return res.status(403).send({ message: "forbidden access" });
      const filter = { _id: new ObjectId(id), createdBy: req.token_email };
      const updateDoc = { $set: updatedData };
      const result = await modelCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Smart server is running");
});

app.listen(port, () => {
  console.log(`Server running on ${port}`);
});
