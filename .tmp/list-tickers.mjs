import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  SELECT DISTINCT p.ticker
  FROM positions p
  JOIN valuations v ON v.position_id = p.id
  ORDER BY p.ticker
`;
console.log(rows.map(r => r.ticker).join(" "));
