#include <stdlib.h>

__attribute__((constructor)) static void clear_ld_preload_for_exec_children(void) {
  unsetenv("LD_PRELOAD");
}
