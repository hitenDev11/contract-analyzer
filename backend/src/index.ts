import 'dotenv/config';
import app from './app';
import connectDB from './db/db';
import cron from 'node-cron';
import { processPendingFileDeletions } from './services/file-deletion.service';


const PORT = process.env.PORT || 5000;

cron.schedule('*/5 * * * *', async () => {
  try {
    await processPendingFileDeletions();
  } catch (error) {
    console.error('File deletion worker failed:', error);
  }
});

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();