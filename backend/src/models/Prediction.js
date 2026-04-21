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
    rulePrediction: {
      type: Number,
      required: true,
      default: 0,
    },
    mlPrediction: {
      type: Number,
      required: true,
      default: 0,
    },
    adjustedPrediction: {
      type: Number,
      required: true,
      default: 0,
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
    decision: {
      type: String,
      enum: ["increase", "maintain", "reduce"],
      default: "maintain",
      required: true,
    },
    impact: {
      type: String,
      enum: ["increase", "decrease", "neutral"],
      default: "neutral",
      required: true,
    },
    reason: {
      type: String,
      required: true,
      default: "No explanation available",
    },
    contributingFactors: {
      type: [
        {
          key: { type: String, required: true },
          value: { type: mongoose.Schema.Types.Mixed, required: true },
          source: { type: String, required: true },
        },
      ],
      default: [],
    },
    predictionSource: {
      type: String,
      enum: ["ml", "rule-based"],
      required: true,
      default: "rule-based",
    },
    predictedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Prediction", predictionSchema);