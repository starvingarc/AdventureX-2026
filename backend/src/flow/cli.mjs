import "../env.js";
import { runImageFlow } from "./index.js";

const imagePath = process.argv[2] || "image.jpg";
const sourceUrl = process.argv.find((arg) => arg.startsWith("http")) || "";
const result = await runImageFlow({ imagePath, sourceUrl });
console.log(JSON.stringify(result, null, 2));
