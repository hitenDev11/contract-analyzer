import mongoose, { Document, Schema, Types } from "mongoose"; 

interface FlaggedRisk extends Document {
    clauseSummary: string,
    riskLevel: 'low' | 'medium' | 'high',
    explanation: string
}

export interface contract extends Document {
    userId:  Types.ObjectId,
    fileName: string,
    originalFileURL:string,
    status: 'processing' | 'ready' | 'failed',
    flaggedRisks: FlaggedRisk[]
}

const contractSchema = new Schema<contract>({
    userId:{
        type:Schema.Types.ObjectId,
        ref:'User',
        required:true
    },
    fileName:{
        type:String,
        required:true
    },
    originalFileURL:{
        type:String,
        required:true
    },
    status:{
        type:String,
        required:true
    },
      flaggedRisks: [
      {
        clauseSummary: String,
        riskLevel: {
          type: String,
          enum: ["low", "medium", "high"],
        },
        explanation: String,
      },
    ],
},
{
    timestamps:true
})

export default mongoose.model<contract>('Contract',contractSchema)