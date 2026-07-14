/** Shared, honest compatibility copy.  Do not replace this with a retry prompt: a
 * pre-0034 database cannot make these operations safe. */
export const SAVE_DURABILITY_UPDATE_MESSAGE =
  'This save arrives with the next database update. Reload the app after the update.'

export const DELETE_PERMISSION_MESSAGE =
  'This record could not be deleted — you may not have permission.'

export const LEGACY_MATRIX_PARK_MESSAGE =
  'This older matrix save needs attention because its original matrix snapshot is unknown. Review it after the database update.'
