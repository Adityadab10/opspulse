import express from "express";
import csvUpload from "../config/multer.js";
import { uploadSalesCsv } from "../controllers/uploadController.js";

const router = express.Router();

router.post("/", csvUpload.single("file"), uploadSalesCsv);

export default router;