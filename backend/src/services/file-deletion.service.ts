import PendingFileDeletionModel from
  '../models/pending-file-deletion.model';

import { deleteContractPDF } from './storage.service';

export const processPendingFileDeletions = async () => {
  const jobs = await PendingFileDeletionModel.find({
    nextRetryAt: { $lte: new Date() },
  }).limit(20);

  for (const job of jobs) {
    try {
      await deleteContractPDF(job.publicId);

      await PendingFileDeletionModel.deleteOne({
        _id: job._id,
      });
    } catch (error) {
      const attempts = job.attempts + 1;

      await PendingFileDeletionModel.updateOne(
        { _id: job._id },
        {
          $set: {
            attempts,
            nextRetryAt: new Date(
              Date.now() +
                Math.min(60_000 * 2 ** attempts, 86_400_000)
            ),
            lastError:
              error instanceof Error
                ? error.message
                : 'Unknown error',
          },
        }
      );
    }
  }
};