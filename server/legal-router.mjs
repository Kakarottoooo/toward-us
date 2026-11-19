import express from "express";
import { LEGAL_PAGES, renderLegalPage } from "./legal.mjs";

const pick = (req) => {
  const asked = String(req.query.lang || "").toLowerCase();
  if (["zh", "en", "es"].includes(asked)) return asked;
  const header = String(req.get("accept-language") || "").toLowerCase();
  return header.startsWith("zh") ? "zh" : header.startsWith("es") ? "es" : "en";
};

export function createLegalRouter({ env = process.env } = {}) {
  const router = express.Router();
  for (const page of LEGAL_PAGES) router.get(`/${page}`, (req, res) => { res.set("Cache-Control", "public, max-age=300"); res.type("html").send(renderLegalPage(page, pick(req), env)); });
  return router;
}
