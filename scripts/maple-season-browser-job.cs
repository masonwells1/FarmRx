using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public sealed class MapleSeasonOwnedJob : IDisposable
{
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateNoWindow = 0x08000000;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint StartfUseStdHandles = 0x00000100;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint FileShareDelete = 0x00000004;
    private const uint CreateAlways = 2;
    private const uint OpenExisting = 3;
    private const uint FileAttributeNormal = 0x00000080;
    private const uint WaitObject0 = 0;
    private const uint WaitTimeout = 258;
    private const uint WaitFailed = uint.MaxValue;
    private const uint StillActive = 259;
    private const int ErrorInsufficientBuffer = 122;
    private const int ErrorMoreData = 234;
    private const int JobObjectBasicProcessIdList = 3;
    private const int JobObjectExtendedLimitInformation = 9;
    private static readonly UIntPtr ProcThreadAttributeHandleList = new UIntPtr(0x00020002);

    private delegate bool TerminateProcessCall(IntPtr process, uint exitCode);
    private delegate uint WaitForSingleObjectCall(IntPtr handle, uint milliseconds);
    private delegate int GetLastErrorCall();

    private IntPtr jobHandle;
    private IntPtr processHandle;
    private bool disposed;

    public int RootProcessId { get; private set; }

    private MapleSeasonOwnedJob() { }

    public static MapleSeasonOwnedJob Start(
        string executable,
        string arguments,
        string workingDirectory,
        string standardOutputPath,
        string standardErrorPath)
    {
        var owned = new MapleSeasonOwnedJob();
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        IntPtr stdoutHandle = IntPtr.Zero;
        IntPtr stderrHandle = IntPtr.Zero;
        IntPtr stdinHandle = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        IntPtr inheritedHandleList = IntPtr.Zero;
        bool attributeListInitialized = false;
        bool resumed = false;

        try
        {
            owned.jobHandle = CreateJobObject(IntPtr.Zero, null);
            ThrowIfInvalid(owned.jobHandle, "CreateJobObject");

            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
            if (!SetInformationJobObject(
                    owned.jobHandle,
                    JobObjectExtendedLimitInformation,
                    ref limits,
                    (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "SetInformationJobObject failed.");
            }

            var inheritable = new SECURITY_ATTRIBUTES();
            inheritable.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
            inheritable.bInheritHandle = true;
            stdoutHandle = CreateFile(
                standardOutputPath,
                GenericWrite,
                FileShareRead | FileShareWrite | FileShareDelete,
                ref inheritable,
                CreateAlways,
                FileAttributeNormal,
                IntPtr.Zero);
            ThrowIfInvalid(stdoutHandle, "CreateFile(stdout)");
            stderrHandle = CreateFile(
                standardErrorPath,
                GenericWrite,
                FileShareRead | FileShareWrite | FileShareDelete,
                ref inheritable,
                CreateAlways,
                FileAttributeNormal,
                IntPtr.Zero);
            ThrowIfInvalid(stderrHandle, "CreateFile(stderr)");
            stdinHandle = CreateFile(
                "NUL",
                GenericRead,
                FileShareRead | FileShareWrite,
                ref inheritable,
                OpenExisting,
                FileAttributeNormal,
                IntPtr.Zero);
            ThrowIfInvalid(stdinHandle, "CreateFile(stdin)");

            UIntPtr attributeListSize = UIntPtr.Zero;
            bool unexpectedSizeSuccess = InitializeProcThreadAttributeList(
                IntPtr.Zero,
                1,
                0,
                ref attributeListSize);
            int sizeError = Marshal.GetLastWin32Error();
            if (unexpectedSizeSuccess || attributeListSize == UIntPtr.Zero || sizeError != ErrorInsufficientBuffer)
            {
                throw new Win32Exception(sizeError, "InitializeProcThreadAttributeList sizing failed.");
            }
            attributeList = Marshal.AllocHGlobal(checked((IntPtr)checked((long)attributeListSize.ToUInt64())));
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeListSize))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "InitializeProcThreadAttributeList failed.");
            }
            attributeListInitialized = true;

            int inheritedHandleBytes = checked(3 * IntPtr.Size);
            inheritedHandleList = Marshal.AllocHGlobal(inheritedHandleBytes);
            Marshal.WriteIntPtr(inheritedHandleList, 0 * IntPtr.Size, stdinHandle);
            Marshal.WriteIntPtr(inheritedHandleList, 1 * IntPtr.Size, stdoutHandle);
            Marshal.WriteIntPtr(inheritedHandleList, 2 * IntPtr.Size, stderrHandle);
            if (!UpdateProcThreadAttribute(
                    attributeList,
                    0,
                    ProcThreadAttributeHandleList,
                    inheritedHandleList,
                    new UIntPtr(checked((uint)inheritedHandleBytes)),
                    IntPtr.Zero,
                    IntPtr.Zero))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "UpdateProcThreadAttribute(handle list) failed.");
            }

            var startup = new STARTUPINFOEX();
            startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            startup.StartupInfo.dwFlags = StartfUseStdHandles;
            startup.StartupInfo.hStdInput = stdinHandle;
            startup.StartupInfo.hStdOutput = stdoutHandle;
            startup.StartupInfo.hStdError = stderrHandle;
            startup.lpAttributeList = attributeList;
            var commandLine = new StringBuilder("\"" + executable + "\" " + arguments);

            if (!CreateProcess(
                    executable,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    CreateSuspended | CreateNoWindow | ExtendedStartupInfoPresent,
                    IntPtr.Zero,
                    workingDirectory,
                    ref startup,
                    out process))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcess failed.");
            }

            owned.processHandle = process.hProcess;
            owned.RootProcessId = checked((int)process.dwProcessId);

            if (!AssignProcessToJobObject(owned.jobHandle, process.hProcess))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject failed.");
            }

            bool belongsToJob;
            if (!IsProcessInJob(process.hProcess, owned.jobHandle, out belongsToJob) || !belongsToJob)
            {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "The suspended browser root was not verified in its owned job.");
            }

            if (ResumeThread(process.hThread) == uint.MaxValue)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "ResumeThread failed.");
            }
            resumed = true;
            return owned;
        }
        catch (Exception primaryFailure)
        {
            Exception cleanupFailure = null;
            if (process.hProcess != IntPtr.Zero)
            {
                cleanupFailure = GetSuspendedProcessCleanupFailure(
                    process.hProcess,
                    TerminateProcess,
                    WaitForSingleObject,
                    Marshal.GetLastWin32Error);
            }
            owned.Dispose();
            if (cleanupFailure != null)
            {
                throw new AggregateException(
                    "Suspended browser launch and exact cleanup both failed.",
                    new Exception[] { primaryFailure, cleanupFailure });
            }
            throw;
        }
        finally
        {
            if (!resumed && process.hThread != IntPtr.Zero)
            {
                // The catch path terminates the still-suspended root before this handle closes.
            }
            CloseIfValid(process.hThread);
            CloseIfValid(stdoutHandle);
            CloseIfValid(stderrHandle);
            CloseIfValid(stdinHandle);
            if (attributeListInitialized) DeleteProcThreadAttributeList(attributeList);
            if (inheritedHandleList != IntPtr.Zero) Marshal.FreeHGlobal(inheritedHandleList);
            if (attributeList != IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
        }
    }

    public static void ProbeAssignmentFailureCleanupForTest(string fault)
    {
        var primaryFailure = new Win32Exception(5, "AssignProcessToJobObject failed.");
        TerminateProcessCall terminate = delegate(IntPtr process, uint exitCode)
        {
            return !String.Equals(fault, "terminate-false", StringComparison.Ordinal);
        };
        WaitForSingleObjectCall wait = delegate(IntPtr process, uint milliseconds)
        {
            if (String.Equals(fault, "wait-failed", StringComparison.Ordinal)) return WaitFailed;
            if (String.Equals(fault, "wait-timeout", StringComparison.Ordinal)) return WaitTimeout;
            return WaitObject0;
        };
        GetLastErrorCall lastError = delegate { return 1234; };
        Exception cleanupFailure = GetSuspendedProcessCleanupFailure(
            new IntPtr(1),
            terminate,
            wait,
            lastError);
        if (cleanupFailure == null) throw primaryFailure;
        throw new AggregateException(
            "Suspended browser launch and exact cleanup both failed.",
            new Exception[] { primaryFailure, cleanupFailure });
    }

    private static Exception GetSuspendedProcessCleanupFailure(
        IntPtr process,
        TerminateProcessCall terminate,
        WaitForSingleObjectCall wait,
        GetLastErrorCall getLastError)
    {
        if (!terminate(process, 125))
        {
            return new Win32Exception(
                getLastError(),
                "TerminateProcess failed while cleaning a suspended browser root.");
        }
        uint waitResult = wait(process, 10000);
        if (waitResult == WaitObject0) return null;
        if (waitResult == WaitFailed)
        {
            return new Win32Exception(
                getLastError(),
                "WaitForSingleObject failed while cleaning a suspended browser root.");
        }
        if (waitResult == WaitTimeout)
        {
            return new TimeoutException("Timed out waiting for a suspended browser root to terminate.");
        }
        return new InvalidOperationException(
            "WaitForSingleObject returned an unexpected suspended-root cleanup result " + waitResult + ".");
    }

    public bool WaitForExit(int milliseconds)
    {
        EnsureAvailable();
        uint result = WaitForSingleObject(processHandle, checked((uint)milliseconds));
        if (result == WaitObject0) return true;
        if (result == WaitTimeout) return false;
        throw new Win32Exception(Marshal.GetLastWin32Error(), "WaitForSingleObject failed.");
    }

    public int GetExitCode()
    {
        EnsureAvailable();
        uint code;
        if (!GetExitCodeProcess(processHandle, out code))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "GetExitCodeProcess failed.");
        }
        if (code == StillActive) throw new InvalidOperationException("The browser root is still active.");
        return unchecked((int)code);
    }

    public int[] GetActiveProcessIds()
    {
        EnsureAvailable();
        int capacity = 16;
        while (capacity <= 4096)
        {
            int bytes = checked(8 + (capacity * IntPtr.Size));
            IntPtr buffer = Marshal.AllocHGlobal(bytes);
            try
            {
                uint returned;
                bool ok = QueryInformationJobObject(
                    jobHandle,
                    JobObjectBasicProcessIdList,
                    buffer,
                    (uint)bytes,
                    out returned);
                int error = ok ? 0 : Marshal.GetLastWin32Error();
                int assigned = Marshal.ReadInt32(buffer, 0);
                int listed = Marshal.ReadInt32(buffer, 4);
                if (ok && assigned <= capacity && listed <= capacity)
                {
                    var ids = new List<int>(listed);
                    for (int index = 0; index < listed; index++)
                    {
                        long raw = IntPtr.Size == 8
                            ? Marshal.ReadInt64(buffer, 8 + (index * IntPtr.Size))
                            : Marshal.ReadInt32(buffer, 8 + (index * IntPtr.Size));
                        ids.Add(checked((int)raw));
                    }
                    ids.Sort();
                    return ids.ToArray();
                }
                if (error != ErrorMoreData && !(ok && assigned > capacity))
                {
                    throw new Win32Exception(error, "QueryInformationJobObject failed.");
                }
                capacity = Math.Max(capacity * 2, assigned + 8);
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        throw new InvalidOperationException("The owned browser job process list exceeded its bounded capacity.");
    }

    public void Terminate(int exitCode)
    {
        EnsureAvailable();
        if (!TerminateJobObject(jobHandle, unchecked((uint)exitCode)))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "TerminateJobObject failed.");
        }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        CloseIfValid(processHandle);
        processHandle = IntPtr.Zero;
        CloseIfValid(jobHandle);
        jobHandle = IntPtr.Zero;
        GC.SuppressFinalize(this);
    }

    private void EnsureAvailable()
    {
        if (disposed || jobHandle == IntPtr.Zero || processHandle == IntPtr.Zero)
            throw new ObjectDisposedException("MapleSeasonOwnedJob");
    }

    private static void ThrowIfInvalid(IntPtr handle, string operation)
    {
        if (handle == IntPtr.Zero || handle == new IntPtr(-1))
            throw new Win32Exception(Marshal.GetLastWin32Error(), operation + " failed.");
    }

    private static void CloseIfValid(IntPtr handle)
    {
        if (handle != IntPtr.Zero && handle != new IntPtr(-1)) CloseHandle(handle);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information,
        uint informationLength);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFOEX startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr attributeList,
        int attributeCount,
        int flags,
        ref UIntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr attributeList,
        uint flags,
        UIntPtr attribute,
        IntPtr value,
        UIntPtr size,
        IntPtr previousValue,
        IntPtr returnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsProcessInJob(IntPtr process, IntPtr job, [MarshalAs(UnmanagedType.Bool)] out bool result);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength,
        out uint returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        ref SECURITY_ATTRIBUTES securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
}
