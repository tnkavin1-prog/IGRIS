using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;

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

    public static class Win32Input {
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

        public static readonly IntPtr DPI_AWARENESS_CONTEXT_UNAWARE = new IntPtr(-1);
        public static readonly IntPtr DPI_AWARENESS_CONTEXT_SYSTEM_AWARE = new IntPtr(-2);
        public static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE = new IntPtr(-3);
        public static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);
        public static readonly IntPtr DPI_AWARENESS_CONTEXT_UNAWARE_GDISCALED = new IntPtr(-5);

        static Win32Input() {
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

        private const uint KEYEVENTF_KEYUP = 0x0002;

        private const int SW_RESTORE = 9;
        private const int SW_SHOW = 5;
        private const int SW_MINIMIZE = 6;
        private const int SW_MAXIMIZE = 3;
        private const uint WM_CLOSE = 0x0010;
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

        public static bool MoveMouse(int x, int y) {
            bool ok = false;
            RunOnInputDesktop(() => {
                ok = SetCursorPos(x, y);
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
            RunOnInputDesktop(() => {
                SetCursorPos(x, y);
                uint downFlag = MOUSEEVENTF_LEFTDOWN;
                uint upFlag = MOUSEEVENTF_LEFTUP;

                if (string.Equals(button, "right", StringComparison.OrdinalIgnoreCase)) {
                    downFlag = MOUSEEVENTF_RIGHTDOWN;
                    upFlag = MOUSEEVENTF_RIGHTUP;
                } else if (string.Equals(button, "middle", StringComparison.OrdinalIgnoreCase)) {
                    downFlag = MOUSEEVENTF_MIDDLEDOWN;
                    upFlag = MOUSEEVENTF_MIDDLEUP;
                }

                mouse_event(downFlag, 0, 0, 0, UIntPtr.Zero);
                mouse_event(upFlag, 0, 0, 0, UIntPtr.Zero);

                if (isDouble) {
                    Thread.Sleep(60);
                    mouse_event(downFlag, 0, 0, 0, UIntPtr.Zero);
                    mouse_event(upFlag, 0, 0, 0, UIntPtr.Zero);
                }
            });
            return true;
        }

        public static bool Drag(int startX, int startY, int endX, int endY, int steps) {
            RunOnInputDesktop(() => {
                SetCursorPos(startX, startY);
                mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                Thread.Sleep(40);

                if (steps <= 0) steps = 10;
                for (int i = 1; i <= steps; i++) {
                    int currX = startX + (endX - startX) * i / steps;
                    int currY = startY + (endY - startY) * i / steps;
                    SetCursorPos(currX, currY);
                    Thread.Sleep(15);
                }

                mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
            });
            return true;
        }

        public static bool Scroll(int deltaY) {
            RunOnInputDesktop(() => {
                mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)deltaY, UIntPtr.Zero);
            });
            return true;
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

            RunOnInputDesktop(() => {
                for (int i = 0; i < vks.Count; i++) {
                    keybd_event(vks[i], 0, 0, UIntPtr.Zero);
                }
                Thread.Sleep(35);
                for (int i = vks.Count - 1; i >= 0; i--) {
                    keybd_event(vks[i], 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                }
            });
            return true;
        }

        public static bool SendText(string text) {
            if (string.IsNullOrEmpty(text)) return false;

            RunOnInputDesktop(() => {
                foreach (char c in text) {
                    if (c == '\r') continue;
                    if (c == '\n') {
                        keybd_event(0x0D, 0, 0, UIntPtr.Zero);
                        keybd_event(0x0D, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                        Thread.Sleep(10);
                        continue;
                    }
                    if (c == '\t') {
                        keybd_event(0x09, 0, 0, UIntPtr.Zero);
                        keybd_event(0x09, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                        Thread.Sleep(10);
                        continue;
                    }

                    short vkScan = VkKeyScan(c);
                    if (vkScan != -1) {
                        byte vk = (byte)(vkScan & 0xFF);
                        byte shift = (byte)((vkScan >> 8) & 0xFF);

                        bool needShift = (shift & 1) != 0;
                        bool needCtrl = (shift & 2) != 0;
                        bool needAlt = (shift & 4) != 0;

                        if (needShift) keybd_event(0x10, 0, 0, UIntPtr.Zero);
                        if (needCtrl) keybd_event(0x11, 0, 0, UIntPtr.Zero);
                        if (needAlt) keybd_event(0x12, 0, 0, UIntPtr.Zero);

                        keybd_event(vk, 0, 0, UIntPtr.Zero);
                        keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);

                        if (needAlt) keybd_event(0x12, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                        if (needCtrl) keybd_event(0x11, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                        if (needShift) keybd_event(0x10, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                        Thread.Sleep(5);
                    }
                }
            });

            return true;
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
            HashSet<IntPtr> visited = new HashSet<IntPtr>();

            // 1. Try input desktop
            IntPtr hDesk = OpenInputDesktop(0, false, DESKTOP_ALL);
            if (hDesk != IntPtr.Zero) {
                EnumDesktopWindows(hDesk, (hWnd, lParam) => {
                    if (visited.Add(hWnd)) callback(hWnd);
                    return true;
                }, IntPtr.Zero);
                CloseDesktop(hDesk);
            }

            // 2. Try default desktop
            IntPtr hDefault = OpenDesktop("default", 0, false, DESKTOP_ALL);
            if (hDefault != IntPtr.Zero && hDefault != hDesk) {
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
            if (string.IsNullOrEmpty(query)) return IntPtr.Zero;

            long numericHwnd;
            if (long.TryParse(query, out numericHwnd) && numericHwnd > 0) {
                return new IntPtr(numericHwnd);
            }

            IntPtr found = IntPtr.Zero;
            string q = query.Trim();

            EnumerateAllWindows((hWnd) => {
                if (found != IntPtr.Zero) return;
                if (!IsWindowVisible(hWnd) && !IsIconic(hWnd)) return;
                int length = GetWindowTextLength(hWnd);
                if (length == 0) return;

                StringBuilder titleBuilder = new StringBuilder(length + 1);
                GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
                string title = titleBuilder.ToString();

                uint pid = 0;
                GetWindowThreadProcessId(hWnd, out pid);
                string processName = "";
                try {
                    Process p = Process.GetProcessById((int)pid);
                    processName = p.ProcessName;
                } catch {}

                if (title.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0 ||
                    processName.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0) {
                    found = hWnd;
                }
            });

            return found;
        }

        public static bool FocusWindow(string query) {
            IntPtr hwnd = FindWindowByQuery(query);
            if (hwnd != IntPtr.Zero) {
                if (IsIconic(hwnd)) {
                    ShowWindow(hwnd, SW_RESTORE);
                } else {
                    ShowWindow(hwnd, SW_SHOW);
                }

                IntPtr foreWnd = GetForegroundWindow();
                if (foreWnd == hwnd) return true;

                uint foreThread = 0;
                if (foreWnd != IntPtr.Zero) {
                    uint dummyPid;
                    foreThread = GetWindowThreadProcessId(foreWnd, out dummyPid);
                }
                uint appThread = GetCurrentThreadId();

                bool attached = false;
                if (foreThread != appThread && foreThread != 0) {
                    attached = AttachThreadInput(appThread, foreThread, true);
                }

                BringWindowToTop(hwnd);
                bool ok = SetForegroundWindow(hwnd);

                if (attached) {
                    AttachThreadInput(appThread, foreThread, false);
                }

                return ok;
            }
            return false;
        }

        public static bool MinimizeWindow(string query) {
            IntPtr hwnd = FindWindowByQuery(query);
            if (hwnd != IntPtr.Zero) {
                return ShowWindow(hwnd, SW_MINIMIZE);
            }
            return false;
        }

        public static bool MaximizeWindow(string query) {
            IntPtr hwnd = FindWindowByQuery(query);
            if (hwnd != IntPtr.Zero) {
                return ShowWindow(hwnd, SW_MAXIMIZE);
            }
            return false;
        }

        public static bool CloseWindow(string query) {
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

        public static bool ReleaseAllInputs() {
            try {
                RunOnInputDesktop(() => {
                    // Release mouse buttons individually
                    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                    mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
                    mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, UIntPtr.Zero);

                    // Release modifier keys: Ctrl, Alt, Shift, Win (generic + specific L/R)
                    keybd_event(0x11, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // VK_CONTROL
                    keybd_event(0x12, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // VK_MENU (Alt)
                    keybd_event(0x10, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // VK_SHIFT
                    keybd_event(0x5B, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // VK_LWIN
                    keybd_event(0x5C, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // VK_RWIN
                    keybd_event(0xA0, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // VK_LSHIFT
                    keybd_event(0xA1, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // VK_RSHIFT
                    keybd_event(0xA2, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // VK_LCONTROL
                    keybd_event(0xA3, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // VK_RCONTROL
                    keybd_event(0xA4, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // VK_LMENU
                    keybd_event(0xA5, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // VK_RMENU
                });
                return true;
            } catch {
                return false;
            }
        }

        public static int Main(string[] args) {
            InitDpiAwareness();

            if (args.Length == 0) {
                Console.WriteLine("Gemetron Win32Input Service v2.0 (DPI Aware V2)");
                return 0;
            }

            try {
                string verb = args[0].ToLowerInvariant();
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

                    case "type-b64":
                        if (args.Length >= 2) {
                            byte[] bytes = Convert.FromBase64String(args[1]);
                            string text = Encoding.UTF8.GetString(bytes);
                            Console.WriteLine(SendText(text));
                            return 0;
                        }
                        break;

                    case "chord":
                        if (args.Length >= 2) {
                            Console.WriteLine(SendKeyChord(args[1]));
                            return 0;
                        }
                        break;

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
