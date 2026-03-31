import { SUPABASE_STORAGE_BUCKET, supabase } from '../supabase';

export interface StorageCompat {
  bucket: string;
}

export interface StorageReference {
  bucket: string;
  path: string;
}

export const storage: StorageCompat = {
  bucket: SUPABASE_STORAGE_BUCKET,
};

export function ref(storageInstance: StorageCompat, path: string): StorageReference {
  return {
    bucket: storageInstance.bucket,
    path,
  };
}

function dataUrlToBlob(dataUrl: string) {
  const [meta, base64] = dataUrl.split(',');
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] || 'application/octet-stream';
  const bytes = atob(base64);
  const buffer = new Uint8Array(bytes.length);

  for (let i = 0; i < bytes.length; i++) {
    buffer[i] = bytes.charCodeAt(i);
  }

  return new Blob([buffer], { type: mime });
}

export async function uploadString(
  ref: StorageReference,
  data: string,
  format: 'data_url'
) {
  if (format !== 'data_url') {
    throw new Error('Only data_url uploads are supported by this compatibility layer.');
  }

  const blob = dataUrlToBlob(data);
  const { error } = await supabase.storage.from(ref.bucket).upload(ref.path, blob, {
    upsert: true,
    contentType: blob.type,
  });

  if (error) throw error;
}

export async function getDownloadURL(ref: StorageReference) {
  const { data } = supabase.storage.from(ref.bucket).getPublicUrl(ref.path);
  return data.publicUrl;
}
