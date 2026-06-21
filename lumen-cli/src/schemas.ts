import { scope, type } from "arktype";

const CollectionInfoSchema = type({
  id: "string",
  name: "string",
});

const CollectionListSchema = CollectionInfoSchema.array();
const IdsResponseSchema = type({ ids: "string[]" });
const CountSchema = type("number");
const IdOnlySchema = type({ id: "string" });

const MetadataSchema = type({ "[string]": type("string | number | boolean") });

// Chroma v2 query response — arrays-of-arrays with nullable inner fields.
const QueryResponseSchema = scope({
  NullableMetadataSchema: MetadataSchema.or("null"),
  NullableNumberSchema: type("number | null"),
  NullableStringSchema: type("string | null"),
  Schema: {
    ids: "string[][]",
    documents: "NullableStringSchema[][] | null",
    metadatas: "NullableMetadataSchema[][] | null",
    distances: "NullableNumberSchema[][] | null",
  },
}).export().Schema;

type CollectionInfo = typeof CollectionInfoSchema.infer;
type IdsResponse = typeof IdsResponseSchema.infer;
type QueryResponse = typeof QueryResponseSchema.infer;
type Metadata = typeof MetadataSchema.infer;

type SearchRow = {
  id: string;
  document?: string | null;
  metadata?: Metadata | null;
  score?: number | null;
};

export {
  type CollectionInfo,
  CollectionInfoSchema,
  CollectionListSchema,
  CountSchema,
  IdOnlySchema,
  type IdsResponse,
  IdsResponseSchema,
  type Metadata,
  type QueryResponse,
  QueryResponseSchema,
  type SearchRow,
};
