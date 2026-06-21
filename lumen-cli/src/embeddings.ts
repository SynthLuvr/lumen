import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";

let embedder: DefaultEmbeddingFunction | null = null;

const getEmbedder = (): DefaultEmbeddingFunction => {
  if (!embedder) embedder = new DefaultEmbeddingFunction();
  return embedder;
};

const embed = async (texts: string[]): Promise<number[][]> =>
  getEmbedder().generate(texts);

const embedOne = async (text: string): Promise<number[]> => {
  const [vec] = await embed([text]);
  return vec;
};

export { embed, embedOne };
