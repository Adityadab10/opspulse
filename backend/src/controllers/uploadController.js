import csv from "csv-parser";
import { Readable } from "stream";
import Product from "../models/Product.js";
import Sales from "../models/Sales.js";
import { normalizeCsvRow, parseCsvBuffer } from "../helpers/csvHelpers.js";

export const uploadSalesCsv = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({
        message: "CSV file is required (field name: file)",
      });
    }

    const rawRows = await parseCsvBuffer(req.file.buffer);
    if (!rawRows.length) {
      return res.status(400).json({ message: "CSV is empty", valid: 0, invalid: 0 });
    }

    let validRows = [];
    const invalidRows = [];

    rawRows.forEach((row, index) => {
      const normalized = normalizeCsvRow(row);
      if (normalized) {
        validRows.push(normalized);
      } else {
        invalidRows.push({
          rowIndex: index + 1,
          rawRow: row,
          reason: "Missing or invalid required fields (productName, category, quantity, date)",
        });
      }
    });

    // Track product creation vs update
    const uniqueProducts = new Map();
    for (const row of validRows) {
      const key = `${row.productName.toLowerCase()}__${row.category.toLowerCase()}`;
      if (!uniqueProducts.has(key)) {
        uniqueProducts.set(key, {
          name: row.productName,
          category: row.category,
        });
      }
    }

    const productOps = Array.from(uniqueProducts.values()).map((p) => ({
      updateOne: {
        filter: { name: p.name, category: p.category },
        update: { $setOnInsert: { name: p.name, category: p.category } },
        upsert: true,
      },
    }));

    const productWriteResult = productOps.length
      ? await Product.bulkWrite(productOps, { ordered: false })
      : null;

    const productDocs = await Product.find({
      $or: Array.from(uniqueProducts.values()).map((p) => ({
        name: p.name,
        category: p.category,
      })),
    }).lean();

    const productIdByKey = new Map();
    for (const p of productDocs) {
      productIdByKey.set(
        `${p.name.toLowerCase()}__${p.category.toLowerCase()}`,
        p._id
      );
    }

    const salesOps = validRows.map((row) => {
      const key = `${row.productName.toLowerCase()}__${row.category.toLowerCase()}`;
      const productId = productIdByKey.get(key);

      return {
        updateOne: {
          filter: {
            productId,
            date: row.date,
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

    const salesWriteResult = salesOps.length
      ? await Sales.bulkWrite(salesOps, { ordered: false })
      : null;

    const summary = {
      totalRows: rawRows.length,
      validRows: validRows.length,
      invalidRows: invalidRows.length,
      productsCreated: productWriteResult?.upsertedCount || 0,
      salesRecordsInserted: salesWriteResult?.upsertedCount || 0,
      invalidDetails: invalidRows,
    };

    return res.status(201).json({
      message: "Sales data uploaded successfully",
      summary,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to process CSV upload",
      error: error.message,
    });
  }
};