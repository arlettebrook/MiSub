// 修改地区识别、命名或处理链语义时递增，旧的已处理缓存必须重新生成。
export const NODE_PROCESSING_VERSION = 'node-flags-v5';

export function isNodeProcessingVersionCompatible(entry, version = NODE_PROCESSING_VERSION) {
    return Boolean(entry && entry.processingVersion === version);
}
