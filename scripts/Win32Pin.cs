using System;
using System.Text;
using System.Runtime.InteropServices;

namespace Gemetron {
    public static class WindowPin {
        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_SHOWWINDOW = 0x0040;
        private const int SW_RESTORE = 9;

        private static bool IsTerminalClass(string className) {
            if (string.IsNullOrEmpty(className)) return false;
            return className.Equals("ConsoleWindowClass", StringComparison.OrdinalIgnoreCase) ||
                   className.Equals("CASCADIA_HOSTING_WINDOW_CLASS", StringComparison.OrdinalIgnoreCase);
        }

        public static IntPtr FindWindowBySubstring(string substring) {
            IntPtr exactChromeMatch = IntPtr.Zero;
            IntPtr prefixChromeMatch = IntPtr.Zero;
            IntPtr fallbackMatch = IntPtr.Zero;

            EnumWindows((hWnd, lParam) => {
                if (!IsWindowVisible(hWnd) && !IsIconic(hWnd)) return true;
                int length = GetWindowTextLength(hWnd);
                if (length == 0) return true;

                StringBuilder titleBuilder = new StringBuilder(length + 1);
                GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
                string title = titleBuilder.ToString();

                StringBuilder classBuilder = new StringBuilder(256);
                GetClassName(hWnd, classBuilder, classBuilder.Capacity);
                string className = classBuilder.ToString();

                // Never match terminal, console, or command prompt windows
                if (IsTerminalClass(className)) return true;

                bool isChrome = className.IndexOf("Chrome", StringComparison.OrdinalIgnoreCase) >= 0;

                if (isChrome && title.Equals(substring, StringComparison.OrdinalIgnoreCase)) {
                    exactChromeMatch = hWnd;
                    return false; // Stop immediately on exact Chrome companion HUD match
                }

                if (isChrome && prefixChromeMatch == IntPtr.Zero &&
                    title.StartsWith(substring, StringComparison.OrdinalIgnoreCase)) {
                    prefixChromeMatch = hWnd;
                }

                if (fallbackMatch == IntPtr.Zero && title.IndexOf(substring, StringComparison.OrdinalIgnoreCase) >= 0) {
                    fallbackMatch = hWnd;
                }

                return true;
            }, IntPtr.Zero);

            if (exactChromeMatch != IntPtr.Zero) return exactChromeMatch;
            if (prefixChromeMatch != IntPtr.Zero) return prefixChromeMatch;
            return fallbackMatch;
        }

        public static bool PinTopMost(string title) {
            IntPtr hwnd = FindWindowBySubstring(title);
            if (hwnd == IntPtr.Zero) {
                hwnd = FindWindow(null, title);
            }
            if (hwnd != IntPtr.Zero) {
                if (IsIconic(hwnd)) {
                    ShowWindow(hwnd, SW_RESTORE);
                }
                SetForegroundWindow(hwnd);
                return SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW);
            }
            return false;
        }

        public static bool UnpinTopMost(string title) {
            IntPtr hwnd = FindWindowBySubstring(title);
            if (hwnd == IntPtr.Zero) {
                hwnd = FindWindow(null, title);
            }
            if (hwnd != IntPtr.Zero) {
                return SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW);
            }
            return false;
        }
    }
}
