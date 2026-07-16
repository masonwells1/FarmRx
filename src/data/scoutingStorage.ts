import { supabase } from '../lib/supabaseClient'
import { StorageClient } from '@supabase/storage-js'
import { supabaseConfig } from '../lib/supabaseConfig'
import { farmOperationRequestHeaders, type FarmOperationContext } from './farmOperationContext'
const bucket = 'scouting-photos'; const signed = new Map<string, { url: string; expires: number }>()
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const maxScoutingPhotoBytes = 20 * 1024 * 1024
const fileExtension = (file: File) => { const fromName = file.name.split('.').pop()?.toLowerCase(); if (fromName && /^[a-z0-9]{1,10}$/.test(fromName)) return fromName; return file.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'jpg' }
export function validateScoutingPhotoFile(file: Pick<File, 'type' | 'size'>) { if (!allowedImageTypes.has(file.type.toLowerCase())) return 'Choose a JPEG, PNG, WebP, HEIC, or HEIF photo.'; if (file.size > maxScoutingPhotoBytes) return 'Choose a photo smaller than 20 MB.'; return null }
async function operationStorage(context: FarmOperationContext) {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token || data.session.user.id !== context.userId) throw new Error('The signed-in account changed before this photo operation could finish.')
  return new StorageClient(`${supabaseConfig.url}/storage/v1`, {
    apikey: supabaseConfig.publishableKey,
    Authorization: `Bearer ${data.session.access_token}`,
    ...farmOperationRequestHeaders(context),
  })
}
export async function uploadScoutingPhoto(farmId: string, fieldId: string, noteId: string, file: File, context: FarmOperationContext) { const validation = validateScoutingPhotoFile(file); if (validation) throw new Error(validation); if (farmId !== context.farmId) throw new Error('The selected farm changed before this photo operation could finish.'); const filename = `${crypto.randomUUID()}.${fileExtension(file)}`; const storage_path = `${farmId}/${fieldId}/${noteId}/${filename}`; const storage = await operationStorage(context); const { error } = await storage.from(bucket).upload(storage_path, file, { contentType: file.type }); if (error) throw error; return storage_path }
export async function uploadScoutingPhotos(
  farmId: string,
  fieldId: string,
  noteId: string,
  files: File[],
  context: FarmOperationContext,
  verify: (expected: FarmOperationContext) => Promise<void>,
  upload = uploadScoutingPhoto,
  remove = removeScoutingPhotos,
  onOrphaned?: (paths: string[]) => void,
) {
  const uploaded: string[] = []
  try {
    for (const file of files) {
      await verify(context)
      uploaded.push(await upload(farmId, fieldId, noteId, file, context))
      await verify(context)
    }
    return uploaded
  } catch (error) {
    if (uploaded.length) {
      // A changed account/farm/fence must stop here: no later Storage request or
      // cleanup/outbox mutation may be published under a recaptured identity.
      await verify(context)
      try {
        const confirmed = await remove(uploaded, context)
        await verify(context)
        const missed = uploaded.filter((path) => !confirmed.includes(path))
        if (missed.length) onOrphaned?.(missed)
      } catch {
        await verify(context)
        // Audit P2-09: the upload error stays farmer-facing; paths whose cleanup
        // was ambiguous are retained under the initiating user/farm scope.
        onOrphaned?.(uploaded)
      }
    }
    throw error
  }
}
export async function signedUrl(storagePath: string) { const cached = signed.get(storagePath); if (cached && cached.expires > Date.now()) return cached.url; const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 300); if (error || !data?.signedUrl) throw error ?? new Error('Farm Rx could not open this photo.'); signed.set(storagePath, { url: data.signedUrl, expires: Date.now() + 270_000 }); return data.signedUrl }
/** Returns the paths the bucket CONFIRMED removing. Supabase remove() resolves without
 * error while silently omitting RLS-blocked paths, so callers must not treat a resolved
 * call as confirmation — only membership in the returned list counts. */
export async function removeScoutingPhotos(paths: string[], context: FarmOperationContext): Promise<string[]> { if (!paths.length) return []; if (paths.some((path) => path.split('/')[0] !== context.farmId)) throw new Error('The selected farm changed before this photo operation could finish.'); const storage = await operationStorage(context); const { data, error } = await storage.from(bucket).remove(paths); if (error) throw error; const names = (data ?? []).map((object) => (object as { name?: string }).name ?? ''); const confirmed = paths.filter((path) => names.some((name) => name === path || path === name || path.endsWith(`/${name}`))); confirmed.forEach((path) => signed.delete(path)); return confirmed }
