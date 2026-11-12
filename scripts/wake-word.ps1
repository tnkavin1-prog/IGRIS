param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
Add-Type -ReferencedAssemblies ([System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location) -TypeDefinition @'
using System;
using System.IO;
using System.Linq;
using System.Speech.Recognition;
using System.Speech.Synthesis;
public static class GemetronWakeWord {
    public static void Run(bool selfTest) {
        var info = SpeechRecognitionEngine.InstalledRecognizers().FirstOrDefault(r => r.Culture.TwoLetterISOLanguageName == "en");
        if (info == null) throw new InvalidOperationException("Install an English Windows speech recognition language pack.");
        using (var engine = new SpeechRecognitionEngine(info)) {
            var builder = new GrammarBuilder("hey jarvis") { Culture = info.Culture };
            engine.LoadGrammar(new Grammar(builder));
            if (selfTest) {
                using (var stream = new MemoryStream()) {
                    using (var synth = new SpeechSynthesizer()) {
                        synth.SetOutputToWaveStream(stream);
                        synth.Speak("hey jarvis");
                    }
                    stream.Position = 0;
                    engine.SetInputToWaveStream(stream);
                    var result = engine.Recognize();
                    if (result == null || result.Text != "hey jarvis") throw new InvalidOperationException("Synthetic wake-word recognition failed.");
                    Console.WriteLine("self-test:passed");
                }
                return;
            }
            var last = DateTime.MinValue;
            engine.SpeechRecognized += (sender, e) => {
                if (e.Result.Confidence >= 0.65 && (DateTime.UtcNow - last).TotalSeconds >= 5) {
                    last = DateTime.UtcNow;
                    Console.WriteLine("wake");
                    Console.Out.Flush();
                }
            };
            engine.SetInputToDefaultAudioDevice();
            engine.RecognizeAsync(RecognizeMode.Multiple);
            Console.WriteLine("ready");
            Console.Out.Flush();
            Console.ReadLine();
            engine.RecognizeAsyncCancel();
        }
    }
}
'@
[GemetronWakeWord]::Run($SelfTest.IsPresent)
