using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Text.RegularExpressions;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Windows.Automation;

namespace Gemetron {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct WINDOWPLACEMENT {
        public int length;
        public int flags;
        public int showCmd;
        public POINT ptMinPosition;
        public POINT ptMaxPosition;
        public RECT rcNormalPosition;
    }

    [DataContract]
    public sealed class NativeRequest {
        [DataMember] public string id { get; set; }
        [DataMember] public string action { get; set; }
        [DataMember] public string[] args { get; set; }
    }

    [DataContract]
    public sealed class NativeResponse {
        [DataMember] public string id { get; set; }
        [DataMember] public bool ok { get; set; }
        [DataMember] public string result { get; set; }
        [DataMember] public string error { get; set; }
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public INPUTUNION U;
    }

    public static class Win32Input {
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern short VkKeyScan(char ch);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool IsZoomed(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpfn, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetThreadDesktop(IntPtr hDesktop);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool CloseDesktop(IntPtr hDesktop);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

        [DllImport("user32.dll")]
        public static extern IntPtr GetProcessDpiAwarenessContext(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern IntPtr GetThreadDpiAwarenessContext();

        [DllImport("user32.dll")]
        public static extern bool SetThreadDpiAwarenessContext(IntPtr dpiContext);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern int SHGetKnownFolderPath(
            [MarshalAs(UnmanagedType.LPStruct)] Guid rfid,
            uint dwFlags,
            IntPtr hToken,
            out IntPtr ppszPath);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr ShellExecuteW(
            IntPtr hwnd,
            string lpOperation,
            string lpFile,
            string lpParameters,
            string lpDirectory,
            int nShowCmd);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool FreeLibrary(IntPtr hModule);

        public static readonly IntPtr DPI_AWARENESS_CONTEXT_UNAWARE = new IntPtr(-1);
        public static readonly IntPtr DPI_AWARENESS_CONTEXT_SYSTEM_AWARE = new IntPtr(-2);
        public static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE = new IntPtr(-3);
        public static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);
        public static readonly IntPtr DPI_AWARENESS_CONTEXT_UNAWARE_GDISCALED = new IntPtr(-5);

        // Known folder identifiers. Resolving them through the shell honours
        // OneDrive redirection and localised folder names, which a hardcoded
        // "%USERPROFILE%\Desktop" never can.
        private static readonly Guid FolderDesktop = new Guid("B4BFCC3A-DB2C-424C-B029-7FE99A87C641");
        private static readonly Guid FolderDocuments = new Guid("FDD39AD0-238F-46AF-ADB4-6C85480369C7");
        private static readonly Guid FolderDownloads = new Guid("374DE290-123F-4565-9164-39C4925E467B");
        private static readonly Guid FolderPictures = new Guid("33E28130-4E1E-4676-835A-98395C3BC3BB");
        private static readonly Guid FolderMusic = new Guid("4BD8D571-6D19-48D3-BE97-422220080E43");
        private static readonly Guid FolderVideos = new Guid("18989B1D-99B5-455B-841C-AB7C74E4DDFC");

        public static bool AttachToInputDesktop() {
            try {
                IntPtr hDesk = OpenInputDesktop(0, false, DESKTOP_ALL);
                if (hDesk == IntPtr.Zero) {
                    hDesk = OpenDesktop("default", 0, false, DESKTOP_ALL);
                }
                if (hDesk != IntPtr.Zero) {
                    return SetThreadDesktop(hDesk);
                }
            } catch { }
            return false;
        }

        static Win32Input() {
            AttachToInputDesktop();
            InitDpiAwareness();
        }

        public static bool InitDpiAwareness() {
            try {
                if (SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) {
                    return true;
                }
            } catch { }

            try {
                return SetProcessDPIAware();
            } catch {
                return false;
            }
        }

        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;
        private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        private const uint MOUSEEVENTF_WHEEL = 0x0800;
        private const uint MOUSEEVENTF_HWHEEL = 0x01000;

        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const uint KEYEVENTF_UNICODE = 0x0004;
        private const uint INPUT_MOUSE = 0;
        private const uint INPUT_KEYBOARD = 1;

        private const int SW_RESTORE = 9;
        private const int SW_SHOW = 5;
        private const int SW_MINIMIZE = 6;
        private const int SW_MAXIMIZE = 3;
        private const uint WM_CLOSE = 0x0010;
        private const uint WM_SYSCOMMAND = 0x0112;
        private const int SC_MAXIMIZE = 0xF030;
        private const int SC_MINIMIZE = 0xF020;
        private const int SC_RESTORE = 0xF120;
        private const byte VK_MENU = 0x12;
        private const uint DESKTOP_ALL = 0x01FF;

        private static void RunOnInputDesktop(Action action) {
            IntPtr hDesk = OpenInputDesktop(0, false, DESKTOP_ALL);
            if (hDesk == IntPtr.Zero) {
                hDesk = OpenDesktop("default", 0, false, DESKTOP_ALL);
            }

            if (hDesk == IntPtr.Zero) {
                action();
                return;
            }

            Exception threadEx = null;
            Thread t = new Thread(() => {
                try {
                    SetThreadDesktop(hDesk);
                    action();
                } catch (Exception ex) {
                    threadEx = ex;
                }
            });
            t.Start();
            t.Join();
            CloseDesktop(hDesk);

            if (threadEx != null) {
                throw threadEx;
            }
        }

        private static bool SendMouseInput(uint flags, uint data = 0) {
            INPUT[] inputs = new INPUT[1];
            inputs[0].type = INPUT_MOUSE;
            inputs[0].U.mi.dwFlags = flags;
            inputs[0].U.mi.mouseData = data;
            return SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT))) == 1;
        }

        private static bool SendKeyInput(ushort vk, bool keyUp, ushort scan = 0, bool unicode = false) {
            INPUT[] inputs = new INPUT[1];
            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].U.ki.wVk = unicode ? (ushort)0 : vk;
            inputs[0].U.ki.wScan = scan;
            inputs[0].U.ki.dwFlags = (keyUp ? KEYEVENTF_KEYUP : 0) | (unicode ? KEYEVENTF_UNICODE : 0);
            return SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT))) == 1;
        }

        public static bool MoveMouse(int x, int y) {
            bool ok = false;
            RunOnInputDesktop(() => {
                ok = SetCursorPos(x, y);
            });
            return ok;
        }

        public static bool MoveMouseSmooth(int x, int y, int durationMs) {
            bool ok = true;
            RunOnInputDesktop(() => {
                POINT start;
                if (!GetCursorPos(out start)) {
                    ok = false;
                    return;
                }
                int duration = Math.Max(0, Math.Min(5000, durationMs));
                int steps = Math.Max(1, Math.Min(120, duration / 8));
                for (int i = 1; i <= steps; i++) {
                    double t = (double)i / steps;
                    double eased = t * t * (3.0 - 2.0 * t);
                    int nextX = start.X + (int)Math.Round((x - start.X) * eased);
                    int nextY = start.Y + (int)Math.Round((y - start.Y) * eased);
                    if (!SetCursorPos(nextX, nextY)) ok = false;
                    if (i < steps && duration > 0) Thread.Sleep(Math.Max(1, duration / steps));
                }
                POINT finalPosition;
                ok = ok && GetCursorPos(out finalPosition) && finalPosition.X == x && finalPosition.Y == y;
            });
            return ok;
        }

        public static string GetCursor() {
            int cx = 0;
            int cy = 0;
            RunOnInputDesktop(() => {
                POINT p;
                if (GetCursorPos(out p)) {
                    cx = p.X;
                    cy = p.Y;
                }
            });
            return cx + "," + cy;
        }

        public static bool Click(int x, int y, string button, bool isDouble) {
            bool ok = false;
            RunOnInputDesktop(() => {
                if (!SetCursorPos(x, y)) return;
                uint downFlag = MOUSEEVENTF_LEFTDOWN;
                uint upFlag = MOUSEEVENTF_LEFTUP;

                if (string.Equals(button, "right", StringComparison.OrdinalIgnoreCase)) {
                    downFlag = MOUSEEVENTF_RIGHTDOWN;
                    upFlag = MOUSEEVENTF_RIGHTUP;
                } else if (string.Equals(button, "middle", StringComparison.OrdinalIgnoreCase)) {
                    downFlag = MOUSEEVENTF_MIDDLEDOWN;
                    upFlag = MOUSEEVENTF_MIDDLEUP;
                }

                ok = SendMouseInput(downFlag) && SendMouseInput(upFlag);
                if (isDouble) {
                    Thread.Sleep(60);
                    ok = ok && SendMouseInput(downFlag) && SendMouseInput(upFlag);
                }
                POINT position;
                ok = ok && GetCursorPos(out position) && position.X == x && position.Y == y;
            });
            return ok;
        }

        public static bool Drag(int startX, int startY, int endX, int endY, int steps) {
            bool ok = false;
            RunOnInputDesktop(() => {
                if (!SetCursorPos(startX, startY) || !SendMouseInput(MOUSEEVENTF_LEFTDOWN)) return;
                Thread.Sleep(40);

                if (steps <= 0) steps = 10;
                ok = true;
                for (int i = 1; i <= steps; i++) {
                    int currX = startX + (endX - startX) * i / steps;
                    int currY = startY + (endY - startY) * i / steps;
                    if (!SetCursorPos(currX, currY)) ok = false;
                    Thread.Sleep(15);
                }

                ok = SendMouseInput(MOUSEEVENTF_LEFTUP) && ok;
            });
            return ok;
        }

        public static bool Scroll(int deltaY) {
            return ScrollAt(-1, -1, deltaY);
        }

        public static bool ScrollAt(int x, int y, int deltaY) {
            bool ok = true;
            RunOnInputDesktop(() => {
                if (x >= 0 && y >= 0) {
                    SetCursorPos(x, y);
                    Thread.Sleep(15);
                }

                int totalSteps = Math.Max(1, Math.Min(5, Math.Abs(deltaY) / 120));
                int stepDelta = deltaY / totalSteps;
                if (stepDelta == 0) stepDelta = deltaY > 0 ? 120 : -120;

                for (int i = 0; i < totalSteps; i++) {
                    unchecked {
                        ok = SendMouseInput(MOUSEEVENTF_WHEEL, (uint)stepDelta) && ok;
                    }
                    if (totalSteps > 1) Thread.Sleep(15);
                }
            });
            return ok;
        }

        public static bool ScrollHorizontal(int x, int y, int deltaX) {
            bool ok = true;
            RunOnInputDesktop(() => {
                if (x >= 0 && y >= 0) SetCursorPos(x, y);
                int totalSteps = Math.Max(1, Math.Min(5, Math.Abs(deltaX) / 120));
                int stepDelta = deltaX / totalSteps;
                if (stepDelta == 0) stepDelta = deltaX > 0 ? 120 : -120;
                for (int i = 0; i < totalSteps; i++) {
                    unchecked {
                        ok = SendMouseInput(MOUSEEVENTF_HWHEEL, (uint)stepDelta) && ok;
                    }
                    if (totalSteps > 1) Thread.Sleep(15);
                }
            });
            return ok;
        }

        private static byte MapKeyNameToVk(string key) {
            string norm = key.Trim().ToUpperInvariant();
            switch (norm) {
                case "CTRL":
                case "CONTROL":
                    return 0x11;
                case "LCTRL":
                    return 0xA2;
                case "RCTRL":
                    return 0xA3;
                case "ALT":
                case "MENU":
                    return 0x12;
                case "SHIFT":
                    return 0x10;
                case "WIN":
                case "WINDOWS":
                case "META":
                case "CMD":
                    return 0x5B;
                case "ENTER":
                case "RETURN":
                    return 0x0D;
                case "ESC":
                case "ESCAPE":
                    return 0x1B;
                case "TAB":
                    return 0x09;
                case "SPACE":
                    return 0x20;
                case "BACKSPACE":
                    return 0x08;
                case "DELETE":
                case "DEL":
                    return 0x2E;
                case "INSERT":
                case "INS":
                    return 0x2D;
                case "HOME":
                    return 0x24;
                case "END":
                    return 0x23;
                case "PAGEUP":
                case "PGUP":
                    return 0x21;
                case "PAGEDOWN":
                case "PGDN":
                    return 0x22;
                case "UP":
                    return 0x26;
                case "DOWN":
                    return 0x28;
                case "LEFT":
                    return 0x25;
                case "RIGHT":
                    return 0x27;
                case "F1": return 0x70;
                case "F2": return 0x71;
                case "F3": return 0x72;
                case "F4": return 0x73;
                case "F5": return 0x74;
                case "F6": return 0x75;
                case "F7": return 0x76;
                case "F8": return 0x77;
                case "F9": return 0x78;
                case "F10": return 0x79;
                case "F11": return 0x7A;
                case "F12": return 0x7B;
                default:
                    if (norm.Length == 1) {
                        char c = norm[0];
                        if (c >= 'A' && c <= 'Z') return (byte)c;
                        if (c >= '0' && c <= '9') return (byte)c;
                    }
                    return 0;
            }
        }

        public static bool SendKeyChord(string chord) {
            if (string.IsNullOrEmpty(chord)) return false;
            string[] parts = chord.Split(new char[] { '+', '-', ' ' }, StringSplitOptions.RemoveEmptyEntries);
            List<byte> vks = new List<byte>();

            foreach (string p in parts) {
                byte vk = MapKeyNameToVk(p);
                if (vk != 0) vks.Add(vk);
            }

            if (vks.Count == 0) return false;
            bool ok = true;
            RunOnInputDesktop(() => {
                for (int i = 0; i < vks.Count; i++) {
                    ok = SendKeyInput(vks[i], false) && ok;
                }
                Thread.Sleep(35);
                for (int i = vks.Count - 1; i >= 0; i--) {
                    ok = SendKeyInput(vks[i], true) && ok;
                }
            });
            return ok;
        }

        public static bool SetKeyState(string key, bool down) {
            byte vk = MapKeyNameToVk(key);
            if (vk == 0) return false;
            bool ok = false;
            RunOnInputDesktop(() => { ok = SendKeyInput(vk, !down); });
            return ok;
        }

        public static bool SendText(string text) {
            if (string.IsNullOrEmpty(text)) return false;
            bool ok = true;

            RunOnInputDesktop(() => {
                foreach (char c in text) {
                    if (c == '\r') continue;
                    if (c == '\n') {
                        ok = SendKeyInput(0x0D, false) && ok;
                        ok = SendKeyInput(0x0D, true) && ok;
                        Thread.Sleep(5);
                        continue;
                    }
                    if (c == '\t') {
                        ok = SendKeyInput(0x09, false) && ok;
                        ok = SendKeyInput(0x09, true) && ok;
                        Thread.Sleep(5);
                        continue;
                    }

                    ok = SendKeyInput(0, false, c, true) && ok;
                    ok = SendKeyInput(0, true, c, true) && ok;
                }
            });

            return ok;
        }

        private static string EscapeJson(string s) {
            if (string.IsNullOrEmpty(s)) return "";
            StringBuilder sb = new StringBuilder();
            foreach (char c in s) {
                switch (c) {
                    case '\\': sb.Append("\\\\"); break;
                    case '\"': sb.Append("\\\""); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 32) {
                            sb.AppendFormat("\\u{0:X04}", (int)c);
                        } else {
                            sb.Append(c);
                        }
                        break;
                }
            }
            return sb.ToString();
        }

        private static void EnumerateAllWindows(Action<IntPtr> callback) {
            AttachToInputDesktop();
            HashSet<IntPtr> visited = new HashSet<IntPtr>();

            // 1. Try input desktop
            IntPtr hDesk = OpenInputDesktop(0, false, DESKTOP_ALL);
            if (hDesk != IntPtr.Zero) {
                SetThreadDesktop(hDesk);
                EnumDesktopWindows(hDesk, (hWnd, lParam) => {
                    if (visited.Add(hWnd)) callback(hWnd);
                    return true;
                }, IntPtr.Zero);
                CloseDesktop(hDesk);
            }

            // 2. Try default desktop
            IntPtr hDefault = OpenDesktop("default", 0, false, DESKTOP_ALL);
            if (hDefault != IntPtr.Zero && hDefault != hDesk) {
                SetThreadDesktop(hDefault);
                EnumDesktopWindows(hDefault, (hWnd, lParam) => {
                    if (visited.Add(hWnd)) callback(hWnd);
                    return true;
                }, IntPtr.Zero);
                CloseDesktop(hDefault);
            }

            // 3. Current thread desktop as fallback/supplement
            EnumWindows((hWnd, lParam) => {
                if (visited.Add(hWnd)) callback(hWnd);
                return true;
            }, IntPtr.Zero);
        }

        public static string ListWindows() {
            StringBuilder sb = new StringBuilder();
            sb.Append("[");
            bool first = true;

            EnumerateAllWindows((hWnd) => {
                if (!IsWindowVisible(hWnd) && !IsIconic(hWnd)) return;
                int length = GetWindowTextLength(hWnd);
                if (length == 0) return;

                StringBuilder titleBuilder = new StringBuilder(length + 1);
                GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
                string title = titleBuilder.ToString();
                if (string.IsNullOrWhiteSpace(title)) return;

                uint pid = 0;
                GetWindowThreadProcessId(hWnd, out pid);
                string processName = "";
                try {
                    Process p = Process.GetProcessById((int)pid);
                    processName = p.ProcessName;
                } catch {
                    processName = "unknown";
                }

                bool isIconic = IsIconic(hWnd);
                bool isVisible = IsWindowVisible(hWnd);

                if (!first) sb.Append(",");
                first = false;

                sb.Append("{");
                sb.Append("\"hwnd\":").Append(hWnd.ToInt64()).Append(",");
                sb.Append("\"title\":\"").Append(EscapeJson(title)).Append("\",");
                sb.Append("\"processName\":\"").Append(EscapeJson(processName)).Append("\",");
                sb.Append("\"pid\":").Append(pid).Append(",");
                sb.Append("\"isVisible\":").Append(isVisible ? "true" : "false").Append(",");
                sb.Append("\"isIconic\":").Append(isIconic ? "true" : "false");
                sb.Append("}");
            });

            sb.Append("]");
            return sb.ToString();
        }

        public static IntPtr FindWindowByQuery(string query) {
            AttachToInputDesktop();
            string q = (query ?? "").Trim();
            if (string.IsNullOrEmpty(q) ||
                q.Equals("active", StringComparison.OrdinalIgnoreCase) ||
                q.Equals("foreground", StringComparison.OrdinalIgnoreCase) ||
                q.Equals("current", StringComparison.OrdinalIgnoreCase)) {
                return GetForegroundWindow();
            }

            long numericHwnd;
            if (long.TryParse(q, out numericHwnd) && numericHwnd > 0) {
                return new IntPtr(numericHwnd);
            }

            IntPtr found = IntPtr.Zero;
            int bestScore = -1;

            EnumerateAllWindows((hWnd) => {
                if (!IsWindowVisible(hWnd) && !IsIconic(hWnd)) return;
                int length = GetWindowTextLength(hWnd);
                if (length == 0) return;

                RECT rect;
                if (!GetWindowRect(hWnd, out rect)) return;
                int width = rect.Right - rect.Left;
                int height = rect.Bottom - rect.Top;
                if (width < 80 || height < 80) return; // Ignore invisible background worker windows

                StringBuilder titleBuilder = new StringBuilder(length + 1);
                GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
                string title = titleBuilder.ToString();
                if (string.IsNullOrWhiteSpace(title)) return;

                uint pid = 0;
                GetWindowThreadProcessId(hWnd, out pid);
                string processName = "";
                try {
                    Process p = Process.GetProcessById((int)pid);
                    processName = p.ProcessName;
                } catch {}

                int score = 0;
                if (title.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0) score += 10;
                if (processName.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0) score += 5;
                if (q.Equals("chrome", StringComparison.OrdinalIgnoreCase) && processName.Equals("chrome", StringComparison.OrdinalIgnoreCase)) score += 20;

                if (score > bestScore) {
                    bestScore = score;
                    found = hWnd;
                }
            });

            return found;
        }

        /// <summary>
        /// Resolve a well-known folder (Desktop, Documents, Downloads, ...).
        /// The shell knows about OneDrive redirection and localised names,
        /// which is why the paths are never hardcoded.
        /// </summary>
        public static string KnownFolder(string name) {
            string key = (name ?? "").Trim().ToLowerInvariant();
            Guid folderId;
            switch (key) {
                case "desktop": folderId = FolderDesktop; break;
                case "documents": folderId = FolderDocuments; break;
                case "downloads": folderId = FolderDownloads; break;
                case "pictures": case "images": folderId = FolderPictures; break;
                case "music": folderId = FolderMusic; break;
                case "videos": folderId = FolderVideos; break;
                default:
                    throw new ArgumentException("Unknown known folder: " + name);
            }

            IntPtr buffer = IntPtr.Zero;
            try {
                int hr = SHGetKnownFolderPath(folderId, 0, IntPtr.Zero, out buffer);
                if (hr != 0 || buffer == IntPtr.Zero) {
                    return "";
                }
                return Marshal.PtrToStringUni(buffer) ?? "";
            } finally {
                if (buffer != IntPtr.Zero) {
                    Marshal.FreeCoTaskMem(buffer);
                }
            }
        }

        /// <summary>
        /// Open a document with its registered default application.
        /// ShellExecute returns an instance handle; anything above 32 means the
        /// shell accepted the request.
        /// </summary>
        public static bool OpenDocument(string path) {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) {
                return false;
            }
            AttachToInputDesktop();
            IntPtr result = ShellExecuteW(
                IntPtr.Zero,
                "open",
                path,
                null,
                null,
                1 /* SW_SHOWNORMAL */);
            return result.ToInt64() > 32;
        }

        public static bool FocusWindow(string query) {
            AttachToInputDesktop();
            IntPtr hwnd = FindWindowByQuery(query);
            if (hwnd != IntPtr.Zero) {
                if (IsIconic(hwnd)) {
                    ShowWindow(hwnd, SW_RESTORE);
                } else {
                    ShowWindow(hwnd, SW_SHOW);
                }

                // Alt key simulation ensures Windows foreground rights
                SendKeyInput(VK_MENU, false);
                SendKeyInput(VK_MENU, true);

                BringWindowToTop(hwnd);
                bool ok = SetForegroundWindow(hwnd);
                return ok || GetForegroundWindow() == hwnd;
            }
            return false;
        }

        public static bool MinimizeWindow(string query) {
            AttachToInputDesktop();
            IntPtr hwnd = FindWindowByQuery(query);
            if (hwnd == IntPtr.Zero) {
                hwnd = GetForegroundWindow();
            }
            if (hwnd != IntPtr.Zero) {
                SendMessage(hwnd, WM_SYSCOMMAND, (IntPtr)SC_MINIMIZE, IntPtr.Zero);
                ShowWindow(hwnd, SW_MINIMIZE);
                return true;
            }
            return false;
        }

        public static bool MaximizeWindow(string query) {
            AttachToInputDesktop();
            IntPtr hwnd = FindWindowByQuery(query);
            if (hwnd == IntPtr.Zero) {
                hwnd = GetForegroundWindow();
            }
            if (hwnd != IntPtr.Zero) {
                // Ensure foreground focus
                SendKeyInput(VK_MENU, false);
                SendKeyInput(VK_MENU, true);
                BringWindowToTop(hwnd);
                SetForegroundWindow(hwnd);

                // If window was minimized, restore first
                if (IsIconic(hwnd)) {
                    ShowWindow(hwnd, SW_RESTORE);
                    Thread.Sleep(50);
                }

                // Send WM_SYSCOMMAND SC_MAXIMIZE
                SendMessage(hwnd, WM_SYSCOMMAND, (IntPtr)SC_MAXIMIZE, IntPtr.Zero);

                // Direct ShowWindow SW_MAXIMIZE
                ShowWindow(hwnd, SW_MAXIMIZE);

                // SetWindowPlacement ensuring maximized state across Win10/11
                try {
                    WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
                    wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
                    if (GetWindowPlacement(hwnd, ref wp)) {
                        wp.showCmd = SW_MAXIMIZE;
                        SetWindowPlacement(hwnd, ref wp);
                    }
                } catch {}

                return true;
            }
            return false;
        }

        public static bool RestoreWindow(string query) {
            AttachToInputDesktop();
            IntPtr hwnd = FindWindowByQuery(query);
            if (hwnd == IntPtr.Zero) {
                hwnd = GetForegroundWindow();
            }
            if (hwnd != IntPtr.Zero) {
                SendKeyInput(VK_MENU, false);
                SendKeyInput(VK_MENU, true);
                BringWindowToTop(hwnd);
                SetForegroundWindow(hwnd);

                SendMessage(hwnd, WM_SYSCOMMAND, (IntPtr)SC_RESTORE, IntPtr.Zero);
                ShowWindow(hwnd, SW_RESTORE);

                try {
                    WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
                    wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
                    if (GetWindowPlacement(hwnd, ref wp)) {
                        wp.showCmd = SW_RESTORE;
                        SetWindowPlacement(hwnd, ref wp);
                    }
                } catch {}

                return true;
            }
            return false;
        }

        public static bool CloseWindow(string query) {
            AttachToInputDesktop();
            IntPtr hwnd = FindWindowByQuery(query);
            if (hwnd != IntPtr.Zero) {
                return PostMessage(hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            }
            return false;
        }

        public static bool MoveAndResizeWindow(string query, int x, int y, int width, int height) {
            IntPtr hwnd = FindWindowByQuery(query);
            if (hwnd == IntPtr.Zero) return false;

            if (IsIconic(hwnd) || IsZoomed(hwnd)) {
                ShowWindow(hwnd, SW_RESTORE);
            }
            SetForegroundWindow(hwnd);
            return MoveWindow(hwnd, x, y, width, height, true);
        }

        public static string GetWorkArea() {
            var wa = System.Windows.Forms.Screen.PrimaryScreen.WorkingArea;
            return string.Format("{{\"x\":{0},\"y\":{1},\"width\":{2},\"height\":{3}}}", wa.Left, wa.Top, wa.Width, wa.Height);
        }

        public static string GetWindowBounds(string query) {
            int left = 0, top = 0, width = 0, height = 0;
            IntPtr hwnd = FindWindowByQuery(query);
            if (hwnd != IntPtr.Zero) {
                RECT r;
                if (GetWindowRect(hwnd, out r)) {
                    left = r.Left;
                    top = r.Top;
                    width = r.Right - r.Left;
                    height = r.Bottom - r.Top;
                }
            }
            return string.Format("{{\"x\":{0},\"y\":{1},\"width\":{2},\"height\":{3}}}", left, top, width, height);
        }

        public static string FindTextOnScreen(string query, string windowScope = null) {
            if (string.IsNullOrEmpty(query)) return "[]";
            List<string> items = new List<string>();
            string q = query.Trim();
            string scope = string.IsNullOrEmpty(windowScope) ? null : windowScope.Trim();

            EnumerateAllWindows((hWnd) => {
                if (!IsWindowVisible(hWnd) && !IsIconic(hWnd)) return;
                int length = GetWindowTextLength(hWnd);
                string title = "";
                if (length > 0) {
                    StringBuilder titleBuilder = new StringBuilder(length + 1);
                    GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
                    title = titleBuilder.ToString();
                }

                // If a window scope was specified, skip windows that do not match
                if (scope != null) {
                    if (string.IsNullOrEmpty(title) || title.IndexOf(scope, StringComparison.OrdinalIgnoreCase) < 0) {
                        return;
                    }
                }

                if (!string.IsNullOrEmpty(title) && title.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0) {
                    RECT r;
                    if (GetWindowRect(hWnd, out r)) {
                        int w = r.Right - r.Left;
                        int h = r.Bottom - r.Top;
                        if (w > 0 && h > 0) {
                            int cx = r.Left + w / 2;
                            int cy = r.Top + Math.Min(30, h / 2);
                            items.Add(string.Format("{{\"text\":\"{0}\",\"x\":{1},\"y\":{2},\"bounds\":{{\"x\":{3},\"y\":{4},\"width\":{5},\"height\":{6}}},\"confidence\":0.95,\"source\":\"window_title\",\"containerTitle\":\"{7}\"}}",
                                EscapeJson(title), cx, cy, r.Left, r.Top, w, h, EscapeJson(title)));
                        }
                    }
                }

                // Check child controls of this window
                EnumChildWindows(hWnd, (childHwnd, lParam) => {
                    if (!IsWindowVisible(childHwnd)) return true;
                    int childLen = GetWindowTextLength(childHwnd);
                    if (childLen == 0 || childLen > 256) return true;

                    StringBuilder childText = new StringBuilder(childLen + 1);
                    GetWindowText(childHwnd, childText, childText.Capacity);
                    string cText = childText.ToString();

                    if (cText.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0) {
                        RECT cr;
                        if (GetWindowRect(childHwnd, out cr)) {
                            int cw = cr.Right - cr.Left;
                            int ch = cr.Bottom - cr.Top;
                            if (cw > 4 && ch > 4) {
                                int cx = cr.Left + cw / 2;
                                int cy = cr.Top + ch / 2;
                                items.Add(string.Format("{{\"text\":\"{0}\",\"x\":{1},\"y\":{2},\"bounds\":{{\"x\":{3},\"y\":{4},\"width\":{5},\"height\":{6}}},\"confidence\":0.90,\"source\":\"window_control\",\"containerTitle\":\"{7}\"}}",
                                    EscapeJson(cText), cx, cy, cr.Left, cr.Top, cw, ch, EscapeJson(title)));
                            }
                        }
                    }
                    return true;
                }, IntPtr.Zero);
            });

            return "[" + string.Join(",", items.ToArray()) + "]";
        }

        private static List<AutomationElement> FindMatchingUIElements(string query, string windowScope) {
            List<AutomationElement> matches = new List<AutomationElement>();
            AutomationElement root = AutomationElement.RootElement;
            if (!string.IsNullOrWhiteSpace(windowScope)) {
                IntPtr hwnd = FindWindowByQuery(windowScope);
                if (hwnd == IntPtr.Zero) return matches;
                root = AutomationElement.FromHandle(hwnd);
            }
            if (root == null) return matches;

            Condition visible = new NotCondition(
                new PropertyCondition(AutomationElement.IsOffscreenProperty, true));
            AutomationElementCollection elements = root.FindAll(TreeScope.Descendants, visible);
            string q = (query ?? "").Trim();
            List<AutomationElement> partial = new List<AutomationElement>();
            int inspected = 0;
            foreach (AutomationElement element in elements) {
                if (++inspected > 10000 || matches.Count + partial.Count >= 200) break;
                string name = element.Current.Name ?? "";
                string automationId = element.Current.AutomationId ?? "";
                if (q.Length == 0) {
                    matches.Add(element);
                } else if (name.Equals(q, StringComparison.OrdinalIgnoreCase) ||
                           automationId.Equals(q, StringComparison.OrdinalIgnoreCase)) {
                    matches.Add(element);
                } else if (name.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0 ||
                           automationId.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0) {
                    partial.Add(element);
                }
                if (matches.Count >= 100) break;
            }
            foreach (AutomationElement element in partial) {
                if (matches.Count >= 100) break;
                matches.Add(element);
            }
            return matches;
        }

        public static string UIAFind(string query, string windowScope) {
            List<string> items = new List<string>();
            foreach (AutomationElement element in FindMatchingUIElements(query, windowScope)) {
                System.Windows.Rect bounds = element.Current.BoundingRectangle;
                if (bounds.Width <= 0 || bounds.Height <= 0) continue;
                string controlType = element.Current.ControlType.ProgrammaticName;
                int dot = controlType.LastIndexOf('.');
                if (dot >= 0) controlType = controlType.Substring(dot + 1);
                items.Add(string.Format(
                    "{{\"name\":\"{0}\",\"automationId\":\"{1}\",\"controlType\":\"{2}\",\"x\":{3},\"y\":{4},\"width\":{5},\"height\":{6},\"isEnabled\":{7}}}",
                    EscapeJson(element.Current.Name ?? ""),
                    EscapeJson(element.Current.AutomationId ?? ""),
                    EscapeJson(controlType),
                    Math.Round(bounds.Left), Math.Round(bounds.Top),
                    Math.Round(bounds.Width), Math.Round(bounds.Height),
                    element.Current.IsEnabled ? "true" : "false"));
            }
            return "[" + string.Join(",", items.ToArray()) + "]";
        }

        public static bool UIAInvoke(string query, string windowScope) {
            List<AutomationElement> matches = FindMatchingUIElements(query, windowScope);
            if (matches.Count == 0 || !matches[0].Current.IsEnabled) return false;
            AutomationElement element = matches[0];
            object pattern;
            if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) {
                ((InvokePattern)pattern).Invoke();
                return true;
            }
            if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) {
                ((TogglePattern)pattern).Toggle();
                return true;
            }
            if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) {
                ((SelectionItemPattern)pattern).Select();
                return true;
            }
            return false;
        }

        public static bool UIASetValue(string query, string value, string windowScope) {
            List<AutomationElement> matches = FindMatchingUIElements(query, windowScope);
            if (matches.Count == 0 || !matches[0].Current.IsEnabled) return false;
            object pattern;
            if (!matches[0].TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return false;
            ValuePattern valuePattern = (ValuePattern)pattern;
            if (valuePattern.Current.IsReadOnly) return false;
            valuePattern.SetValue(value ?? "");
            return valuePattern.Current.Value == (value ?? "");
        }

        public static bool ReleaseAllInputs() {
            try {
                RunOnInputDesktop(() => {
                    // Release mouse buttons individually
                    SendMouseInput(MOUSEEVENTF_LEFTUP);
                    SendMouseInput(MOUSEEVENTF_RIGHTUP);
                    SendMouseInput(MOUSEEVENTF_MIDDLEUP);

                    ushort[] modifiers = new ushort[] { 0x11, 0x12, 0x10, 0x5B, 0x5C, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5 };
                    foreach (ushort vk in modifiers) SendKeyInput(vk, true);
                });
                return true;
            } catch {
                return false;
            }
        }

        private static string DecodeBase64(string value) {
            return string.IsNullOrEmpty(value) ? "" : Encoding.UTF8.GetString(Convert.FromBase64String(value));
        }

        private static string ExecuteNativeAction(string action, string[] args) {
            switch ((action ?? "").ToLowerInvariant()) {
                case "release-all":
                    return ReleaseAllInputs().ToString();
                case "cursor":
                    return GetCursor();
                case "move":
                    return MoveMouse(int.Parse(args[0]), int.Parse(args[1])).ToString();
                case "smooth-move":
                    return MoveMouseSmooth(int.Parse(args[0]), int.Parse(args[1]), int.Parse(args[2])).ToString();
                case "click":
                    return Click(int.Parse(args[0]), int.Parse(args[1]),
                        args.Length > 2 ? args[2] : "left",
                        args.Length > 3 && (args[3] == "true" || args[3] == "1")).ToString();
                case "drag":
                    return Drag(int.Parse(args[0]), int.Parse(args[1]), int.Parse(args[2]),
                        int.Parse(args[3]), args.Length > 4 ? int.Parse(args[4]) : 10).ToString();
                case "scroll":
                    return Scroll(int.Parse(args[0])).ToString();
                case "scroll-at":
                    return ScrollAt(int.Parse(args[0]), int.Parse(args[1]), int.Parse(args[2])).ToString();
                case "scroll-horizontal":
                    return ScrollHorizontal(int.Parse(args[0]), int.Parse(args[1]), int.Parse(args[2])).ToString();
                case "type-b64":
                    return SendText(DecodeBase64(args[0])).ToString();
                case "chord":
                case "hotkey":
                    return SendKeyChord(args[0]).ToString();
                case "key-state":
                    return SetKeyState(args[0], args[1].Equals("down", StringComparison.OrdinalIgnoreCase)).ToString();
                case "uia-find":
                    return UIAFind(DecodeBase64(args[0]), args.Length > 1 ? DecodeBase64(args[1]) : "");
                case "uia-invoke":
                    return UIAInvoke(DecodeBase64(args[0]), args.Length > 1 ? DecodeBase64(args[1]) : "").ToString();
                case "uia-set-value":
                    return UIASetValue(DecodeBase64(args[0]), DecodeBase64(args[1]),
                        args.Length > 2 ? DecodeBase64(args[2]) : "").ToString();
                case "known-folder":
                    return KnownFolder(args.Length > 0 ? args[0] : "desktop");
                case "open-document":
                    return OpenDocument(DecodeBase64(args[0])).ToString();
                default:
                    throw new ArgumentException("Unknown native action: " + action);
            }
        }

        private static string SerializeResponse(NativeResponse response) {
            DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(NativeResponse));
            using (MemoryStream stream = new MemoryStream()) {
                serializer.WriteObject(stream, response);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }

        private static void Serve() {
            Console.InputEncoding = Encoding.UTF8;
            Console.OutputEncoding = new UTF8Encoding(false);
            Console.WriteLine("{\"ready\":true}");
            Console.Out.Flush();
            DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(NativeRequest));
            string line;
            while ((line = Console.ReadLine()) != null) {
                NativeResponse response = new NativeResponse();
                try {
                    NativeRequest request;
                    using (MemoryStream stream = new MemoryStream(Encoding.UTF8.GetBytes(line))) {
                        request = (NativeRequest)serializer.ReadObject(stream);
                    }
                    response.id = request.id;
                    response.result = ExecuteNativeAction(request.action, request.args ?? new string[0]);
                    response.ok = true;
                } catch (Exception ex) {
                    response.ok = false;
                    response.error = ex.Message;
                }
                Console.WriteLine(SerializeResponse(response));
                Console.Out.Flush();
            }
        }

        public static int Main(string[] args) {
            AttachToInputDesktop();
            InitDpiAwareness();

            if (args.Length == 0) {
                Console.WriteLine("Gemetron Win32Input Service v2.0 (DPI Aware V2)");
                return 0;
            }

            try {
                string verb = args[0].ToLowerInvariant();
                if (verb == "serve") {
                    Serve();
                    return 0;
                }
                switch (verb) {
                    case "init-dpi":
                        Console.WriteLine(InitDpiAwareness());
                        return 0;

                    case "release-all":
                        Console.WriteLine(ReleaseAllInputs());
                        return 0;

                    case "window-bounds":
                        if (args.Length >= 2) {
                            Console.WriteLine(GetWindowBounds(args[1]));
                            return 0;
                        }
                        break;
                    case "known-folder":
                        if (args.Length >= 2) {
                            Console.WriteLine(KnownFolder(args[1]));
                            return 0;
                        }
                        break;
                    case "open-document":
                        if (args.Length >= 2) {
                            Console.WriteLine(OpenDocument(DecodeBase64(args[1])).ToString());
                            return 0;
                        }
                        break;
                    case "move":
                        if (args.Length >= 3) {
                            int x = int.Parse(args[1]);
                            int y = int.Parse(args[2]);
                            Console.WriteLine(MoveMouse(x, y));
                            return 0;
                        }
                        break;

                    case "cursor":
                        Console.WriteLine(GetCursor());
                        return 0;

                    case "click":
                        if (args.Length >= 3) {
                            int x = int.Parse(args[1]);
                            int y = int.Parse(args[2]);
                            string btn = args.Length >= 4 ? args[3] : "left";
                            bool dbl = args.Length >= 5 && (args[4] == "true" || args[4] == "1");
                            Console.WriteLine(Click(x, y, btn, dbl));
                            return 0;
                        }
                        break;

                    case "drag":
                        if (args.Length >= 5) {
                            int sx = int.Parse(args[1]);
                            int sy = int.Parse(args[2]);
                            int ex = int.Parse(args[3]);
                            int ey = int.Parse(args[4]);
                            int steps = args.Length >= 6 ? int.Parse(args[5]) : 10;
                            Console.WriteLine(Drag(sx, sy, ex, ey, steps));
                            return 0;
                        }
                        break;

                    case "scroll":
                        if (args.Length >= 2) {
                            int delta = int.Parse(args[1]);
                            Console.WriteLine(Scroll(delta));
                            return 0;
                        }
                        break;

                    case "scroll-at":
                        if (args.Length >= 4) {
                            int sx = int.Parse(args[1]);
                            int sy = int.Parse(args[2]);
                            int sdelta = int.Parse(args[3]);
                            Console.WriteLine(ScrollAt(sx, sy, sdelta));
                            return 0;
                        }
                        break;

                    case "type-b64":
                        if (args.Length >= 2) {
                            byte[] bytes = Convert.FromBase64String(args[1]);
                            string text = Encoding.UTF8.GetString(bytes);
                            Console.WriteLine(SendText(text));
                            return 0;
                        }
                        break;

                    case "chord":
                    case "hotkey":
                        if (args.Length >= 2) {
                            Console.WriteLine(SendKeyChord(args[1]));
                            return 0;
                        }
                        break;

                    case "pagedown":
                    case "page-down":
                        Console.WriteLine(SendKeyChord("PageDown"));
                        return 0;

                    case "pageup":
                    case "page-up":
                        Console.WriteLine(SendKeyChord("PageUp"));
                        return 0;

                    case "click-text":
                        if (args.Length >= 2) {
                            string text = args[1];
                            string scope = args.Length >= 3 ? args[2] : null;
                            string res = FindTextOnScreen(text, scope);
                            Match mx = Regex.Match(res, "\"x\":(\\d+)");
                            Match my = Regex.Match(res, "\"y\":(\\d+)");
                            if (mx.Success && my.Success) {
                                int cx = int.Parse(mx.Groups[1].Value);
                                int cy = int.Parse(my.Groups[1].Value);
                                Console.WriteLine(Click(cx, cy, "left", false));
                                return 0;
                            }
                        }
                        Console.WriteLine("false");
                        return 0;

                    case "list-windows":
                        Console.WriteLine(ListWindows());
                        return 0;

                    case "focus":
                        if (args.Length >= 2) {
                            Console.WriteLine(FocusWindow(args[1]));
                            return 0;
                        }
                        break;

                    case "minimize":
                        if (args.Length >= 2) {
                            Console.WriteLine(MinimizeWindow(args[1]));
                            return 0;
                        }
                        break;

                    case "maximize":
                        if (args.Length >= 2) {
                            Console.WriteLine(MaximizeWindow(args[1]));
                            return 0;
                        }
                        break;

                    case "restore":
                        if (args.Length >= 2) {
                            Console.WriteLine(RestoreWindow(args[1]));
                            return 0;
                        }
                        break;

                    case "close":
                        if (args.Length >= 2) {
                            Console.WriteLine(CloseWindow(args[1]));
                            return 0;
                        }
                        break;

                    case "move-window":
                        if (args.Length >= 6) {
                            int x = int.Parse(args[2]);
                            int y = int.Parse(args[3]);
                            int w = int.Parse(args[4]);
                            int h = int.Parse(args[5]);
                            Console.WriteLine(MoveAndResizeWindow(args[1], x, y, w, h));
                            return 0;
                        }
                        break;

                    case "work-area":
                        Console.WriteLine(GetWorkArea());
                        return 0;

                    case "find-text":
                        if (args.Length >= 3) {
                            Console.WriteLine(FindTextOnScreen(args[1], args[2]));
                            return 0;
                        } else if (args.Length >= 2) {
                            Console.WriteLine(FindTextOnScreen(args[1], null));
                            return 0;
                        }
                        Console.WriteLine("[]");
                        return 0;
                }
            } catch (Exception ex) {
                Console.Error.WriteLine(ex.Message);
                return 1;
            }

            return 1;
        }
    }
}
