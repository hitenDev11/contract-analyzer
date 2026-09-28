import mongoose, { Document, Schema, Types } from "mongoose";

export interface ContractChunk extends Document {
  contractId: Types.ObjectId;
  chunkText: string;
  chunkIndex: number;
  embedding: number[];
}

const ContractChunkSchema = new Schema<ContractChunk>(
  {
    contractId: {
      type: Schema.Types.ObjectId,
      ref: "Contract",
      required: true,
    },
    chunkText: {
      type: String,
      required: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
    },
    embedding: {
      type: [Number],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<ContractChunk>("ContractChunk", ContractChunkSchema);