import mongoose, { Document, Schema } from "mongoose";

export interface User extends Document {
    name: string;
    email: string;
    password: string;
    createdAt?: Date;
    updatedAt?: Date;
    tokenVersion: number
}

const UserSchema = new Schema<User>({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    password: {
        type: String,
        required: true
    },
    tokenVersion: {
        type: Number,
        default: 0,
        required: true,
    },
},
    {
        timestamps: true
    })

export default mongoose.model<User>('User', UserSchema);
