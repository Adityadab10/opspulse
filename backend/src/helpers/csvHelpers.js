import csv from "csv-parser";
import { Readable } from "stream";

export const parseCsvBuffer = (buffer) =>
  new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(buffer)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });

export const normalizeCsvRow = (row) => {
  const productName = String(row.productName || "").trim();
  const category = String(row.category || "").trim();
  const quantity = Number(row.quantity);
  const date = new Date(row.date);

  if (!productName || !category) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (Number.isNaN(date.getTime())) return null;

  return { productName, category, quantity, date };
};