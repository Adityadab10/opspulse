import mongoose from "mongoose";

const predictionSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      unique: true, // one prediction per product (latest)
    },
    predictedDemand: {
      type: Number,
      required: true,
    },
    avgSales: {
      type: Number,
      required: true,
    },
    percentChange: {
      type: Number,
      required: true,
    },
    confidence: {
      type: String,
      enum: ["Low", "Medium", "High"],
      required: true,
    },
    seasonTag: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Prediction", predictionSchema);