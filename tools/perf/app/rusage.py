"""CPU time, wakeups and footprint of other processes through proc_pid_rusage."""
import ctypes, ctypes.util
lib = ctypes.CDLL(ctypes.util.find_library('proc') or '/usr/lib/libproc.dylib')
libc = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
class TB(ctypes.Structure): _fields_ = [('numer', ctypes.c_uint32), ('denom', ctypes.c_uint32)]
tb = TB(); libc.mach_timebase_info(ctypes.byref(tb))
class RU(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_uint8 * 16)] + [(n, ctypes.c_uint64) for n in (
        'user', 'system', 'pkg_idle_wkups', 'interrupt_wkups', 'pageins', 'wired', 'resident',
        'footprint', 'start', 'exit')]
def usage(pid):
    r = RU()
    if lib.proc_pid_rusage(int(pid), 0, ctypes.byref(r)) != 0: return None
    ns = (r.user + r.system) * tb.numer / tb.denom
    return {'cpu_ms': ns / 1e6, 'wakeups': r.pkg_idle_wkups + r.interrupt_wkups, 'footprint_mb': r.footprint / 2**20}
