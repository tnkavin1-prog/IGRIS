$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinMax {
    [DllImport("user32.dll", SetLastError = true)] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder str, int maxCount);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool SetForegroundWindow(IntPtr hWnd);

    public const uint WM_SYSCOMMAND = 0x0112;
    public const int SC_MAXIMIZE = 0xF030;
    public const int SW_MAXIMIZE = 3;
    public const byte VK_MENU = 0x12;
    public const uint KEYEVENTF_KEYUP = 0x0002;

    public static void Inspect(IntPtr hWnd) {
        bool isWin = IsWindow(hWnd);
        StringBuilder sb = new StringBuilder(256);
        GetWindowText(hWnd, sb, 256);
        Console.WriteLine("IsWindow: " + isWin + " Title: " + sb.ToString());

        keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
        keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        bool fg = SetForegroundWindow(hWnd);
        Console.WriteLine("SetForegroundWindow: " + fg + " Err: " + Marshal.GetLastWin32Error());

        bool sw = ShowWindowAsync(hWnd, SW_MAXIMIZE);
        Console.WriteLine("ShowWindowAsync: " + sw + " Err: " + Marshal.GetLastWin32Error());

        bool pm = PostMessage(hWnd, WM_SYSCOMMAND, (IntPtr)SC_MAXIMIZE, IntPtr.Zero);
        Console.WriteLine("PostMessage: " + pm + " Err: " + Marshal.GetLastWin32Error());
    }
}
'@

Add-Type -TypeDefinition $sig -Language CSharp
$hwnd = [IntPtr]1442456
[WinMax]::Inspect($hwnd)
Start-Sleep -Milliseconds 600
Write-Host "Zoomed after: $([WinMax]::IsZoomed($hwnd))"
