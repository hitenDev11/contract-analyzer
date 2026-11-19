
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ChatMessage extends Document {
  contractId: Types.ObjectId;
  userId: Types.ObjectId;
  role: 'user' | 'assistant';
  content: string;
  sourceChunkIds: Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
}

const chatMessageSchema = new Schema<ChatMessage>(
  {
    contractId: {
      type: Schema.Types.ObjectId,
      ref: 'Contract',
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    sourceChunkIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'ContractChunk',
      },
    ],
  },
  {
    timestamps: true,
  }
);

chatMessageSchema.index({
  userId: 1,
  contractId: 1,
  createdAt: 1,
});

export default mongoose.model<ChatMessage>(
  'ChatMessage',
  chatMessageSchema
);
