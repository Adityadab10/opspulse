import csv from "csv-parser";
import { Readable } from "stream";
import Product from "../models/Product.js";
import Sales from "../models/Sales.js";
import { normalizeCsvRow, parseCsvBuffer } from "../helpers/csvHelpers.js";

export const uploadSalesCsv = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: "CSV file is required (field: file)" });
    }

    const rawRows = await parseCsvBuffer(req.file.buffer);
    if (!rawRows.length) {
      return res.status(400).json({ message: "CSV is empty" });
    }

    const normalizedRows = [];
    for (const row of rawRows) {
      const parsed = normalizeCsvRow(row);
      if (parsed) normalizedRows.push(parsed);
    }

    if (!normalizedRows.length) {
      return res.status(400).json({ message: "No valid rows found in CSV" });
    }

    const uniquePairs = new Map();
    for (const row of normalizedRows) {
      const key = `${row.productName.toLowerCase()}__${row.category.toLowerCase()}`;
      if (!uniquePairs.has(key)) {
        uniquePairs.set(key, { name: row.productName, category: row.category });
      }
    }

    const productUpsertOps = Array.from(uniquePairs.values()).map((p) => ({
      updateOne: {
        filter: { name: p.name, category: p.category },
        update: { $setOnInsert: { name: p.name, category: p.category } },
        upsert: true,
      },
    }));

    const productWriteResult =
      productUpsertOps.length > 0
        ? await Product.bulkWrite(productUpsertOps, { ordered: false })
        : null;

    const allProductDocs = await Product.find({
      $or: Array.from(uniquePairs.values()).map((p) => ({ name: p.name, category: p.category })),
    }).lean();

    const productIdByKey = new Map();
    for (const doc of allProductDocs) {
      const key = `${doc.name.toLowerCase()}__${doc.category.toLowerCase()}`;
      productIdByKey.set(key, doc._id);
    }

    const salesUpsertOps = normalizedRows.map((row) => {
      const key = `${row.productName.toLowerCase()}__${row.category.toLowerCase()}`;
      const productId = productIdByKey.get(key);

      return {
        updateOne: {
          filter: {
            productId,
            date: row.date,
            quantity: row.quantity,
          },
          update: {
            $setOnInsert: {
              productId,
              date: row.date,
              quantity: row.quantity,
            },
          },
          upsert: true,
        },
      };
    });

    const salesWriteResult =
      salesUpsertOps.length > 0
        ? await Sales.bulkWrite(salesUpsertOps, { ordered: false })
        : null;

    return res.status(201).json({
      recordsParsed: normalizedRows.length,
      totalRecordsInserted: salesWriteResult?.upsertedCount || 0,
      productsCreated: productWriteResult?.upsertedCount || 0,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to upload and process CSV",
      error: error.message,
    });
  }
};