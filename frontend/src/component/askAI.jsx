import { useState } from "react";
import { useStream } from "./useStream";

const [response, setResponse] = useState("");

async function askAI() {
  setResponse("");

  await useStream(question, (chunk) => {
    setResponse((prev) => prev + chunk);
  });
}
export default askAI