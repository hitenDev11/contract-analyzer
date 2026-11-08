import mongoose, { Schema } from 'mongoose';

const PendingFileDeletionSchema = new Schema(
  {
    publicId: {
      type: String,
      required: true,
      unique: true,
    },

    attempts: {
      type: Number,
      default: 0,
    },

    nextRetryAt: {
      type: Date,
      default: Date.now,
    },

    lastError: {
      type: String,
    },
  },
  { timestamps: true }
);

export default mongoose.model(
  'PendingFileDeletion',
  PendingFileDeletionSchema
);