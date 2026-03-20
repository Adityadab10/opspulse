import express from "express";
import multer from "multer";
import { uploadSalesCsv } from "../controllers/uploadController.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed =
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.toLowerCase().endsWith(".csv");

    if (!allowed) return cb(new Error("Only CSV files are allowed"));
    cb(null, true);
  },
});

router.post("/", upload.single("file"), uploadSalesCsv);

export default router;