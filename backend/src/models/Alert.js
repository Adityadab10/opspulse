import mongoose from "mongoose";

const alertSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    type: {
      type: String,
      enum: ["HIGH_DEMAND", "LOW_DEMAND"],
    },
    message: {
      type: String,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Alert", alertSchema);