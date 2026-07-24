import "../env.js";
import { runImageFlow } from "./index.js";
import { shutdownLocalWhisperPool } from "../media/localWhisperTranscriptionProvider.js";

const imagePath = process.argv[2] || "image.jpg";
const sourceUrl = process.argv.find((arg) => arg.startsWith("http")) || "";
try {
  const result = await runImageFlow({ imagePath, sourceUrl });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await shutdownLocalWhisperPool();
}
