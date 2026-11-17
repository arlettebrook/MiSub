import { previewNodeProcessing } from '../../functions/utils/node-processing.js';

self.onmessage = async ({ data }) => {
    try {
        const result = await previewNodeProcessing(data.samples, data.profile, data.settings);
        self.postMessage({ id: data.id, result });
    } catch (error) {
        self.postMessage({ id: data.id, error: error.message });
    }
};
