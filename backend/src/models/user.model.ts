import mongoose, { Document, Schema } from "mongoose";

export interface User extends Document {
    name:string,
    email:string,
    password:string
}

const UserSchema = new Schema<User>({
    name:{
        type:String,
        required:true
    },
    email:{
        type:String,
        unique:true,
        required:true
    },
    password:{
        type:String,
        required:true
    }
},
{
    timestamps:true
})

export default mongoose.model<User>('User',UserSchema)