"""
Aibo Voice Server - ElevenLabs Edition
Runs locally on port 5002
Uses ElevenLabs Daniel voice for high quality speech
Falls back to Piper TTS if ElevenLabs is unavailable
"""

import os
import io
import sys
import wave
import threading
import numpy as np
import sounddevice as sd
from flask import Flask, request, jsonify
from dotenv import load_dotenv

# Load .env file
load_dotenv()

app = Flask(__name__)

# ── CONFIG ────────────────────────────────────────────────────────────────
AUDIO_DEVICE     = 3
ELEVENLABS_KEY   = os.getenv('ELEVENLABS_API_KEY', '')
ELEVENLABS_VOICE = os.getenv('ELEVENLABS_VOICE_ID', '')
BASE_DIR         = os.path.dirname(os.path.abspath(__file__))
VOICE_DIR        = os.path.join(BASE_DIR, 'voice')
MODEL_PATH       = os.path.join(VOICE_DIR, 'en_US-lessac-medium.onnx')
CONFIG_PATH      = os.path.join(VOICE_DIR, 'en_US-lessac-medium.onnx.json')

# ── LOAD ELEVENLABS ────────────────────────────────────────────────────────
elevenlabs_client = None
if ELEVENLABS_KEY and ELEVENLABS_VOICE:
    try:
        from elevenlabs.client import ElevenLabs
        elevenlabs_client = ElevenLabs(api_key=ELEVENLABS_KEY)
        print(f'[Aibo Voice] ElevenLabs ready — Voice ID: {ELEVENLABS_VOICE}')
    except Exception as e:
        print(f'[Aibo Voice] ElevenLabs init error: {e}')
        elevenlabs_client = None
else:
    print('[Aibo Voice] No ElevenLabs key — falling back to Piper')

# ── LOAD PIPER FALLBACK ────────────────────────────────────────────────────
piper_voice = None
try:
    from piper import PiperVoice
    piper_voice = PiperVoice.load(MODEL_PATH, config_path=CONFIG_PATH, use_cuda=False)
    print('[Aibo Voice] Piper fallback loaded')
except Exception as e:
    print(f'[Aibo Voice] Piper not available: {e}')

if not elevenlabs_client and not piper_voice:
    print('[Aibo Voice] ERROR: No voice engine available')
    sys.exit(1)

speech_lock = threading.Lock()

# ── SPEAK WITH ELEVENLABS ──────────────────────────────────────────────────
def speak_elevenlabs(text):
    try:
        print(f'[Aibo Voice] ElevenLabs speaking: {text[:60]}')

        audio_stream = elevenlabs_client.text_to_speech.convert(
            voice_id    = ELEVENLABS_VOICE,
            text        = text,
            model_id    = 'eleven_turbo_v2',  # fastest model
            output_format = 'pcm_22050',       # raw PCM at 22050Hz
        )

        # Collect all audio chunks
        audio_data = b''.join(audio_stream)

        # Convert raw PCM int16 to float32
        audio_np = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32)
        audio_np = audio_np / 32768.0
        audio_np = audio_np.reshape(-1, 1)  # mono

        with speech_lock:
            sd.play(audio_np, 22050, device=AUDIO_DEVICE, blocking=True)
            sd.wait()

        print('[Aibo Voice] Done speaking')
        return True

    except Exception as e:
        print(f'[Aibo Voice] ElevenLabs error: {e}')
        return False

# ── SPEAK WITH PIPER FALLBACK ──────────────────────────────────────────────
def speak_piper(text):
    try:
        print(f'[Aibo Voice] Piper speaking: {text[:60]}')

        raw_bytes  = io.BytesIO()
        wav_writer = wave.open(raw_bytes, 'wb')
        piper_voice.synthesize_wav(text, wav_writer)
        wav_writer.close()

        raw_bytes.seek(0)
        with wave.open(raw_bytes, 'rb') as wf:
            sample_rate  = wf.getframerate()
            num_channels = wf.getnchannels()
            raw_data     = wf.readframes(wf.getnframes())

        audio_np = np.frombuffer(raw_data, dtype=np.int16).astype(np.float32)
        audio_np = audio_np / 32768.0
        audio_np = audio_np.reshape(-1, num_channels)

        with speech_lock:
            sd.play(audio_np, sample_rate, device=AUDIO_DEVICE, blocking=True)
            sd.wait()

        print('[Aibo Voice] Done speaking')
        return True

    except Exception as e:
        print(f'[Aibo Voice] Piper error: {e}')
        return False

# ── MAIN SPEAK FUNCTION ────────────────────────────────────────────────────
def speak_text(text):
    # Try ElevenLabs first, fall back to Piper
    if elevenlabs_client:
        success = speak_elevenlabs(text)
        if success:
            return
    if piper_voice:
        speak_piper(text)

# ── ROUTES ────────────────────────────────────────────────────────────────
@app.route('/speak', methods=['POST'])
def speak():
    data = request.get_json()
    if not data:
        return jsonify({ 'ok': False, 'error': 'No JSON body' }), 400

    text = data.get('text', '').strip()
    if not text:
        return jsonify({ 'ok': False, 'error': 'No text' }), 400

    # Non-blocking — speak in background thread
    t = threading.Thread(target=speak_text, args=(text,), daemon=True)
    t.start()

    return jsonify({ 'ok': True, 'engine': 'elevenlabs' if elevenlabs_client else 'piper' })

@app.route('/speak/wait', methods=['POST'])
def speak_wait():
    data = request.get_json()
    if not data:
        return jsonify({ 'ok': False, 'error': 'No JSON body' }), 400
    text = data.get('text', '').strip()
    if not text:
        return jsonify({ 'ok': False, 'error': 'No text' }), 400
    speak_text(text)
    return jsonify({ 'ok': True })

@app.route('/stop', methods=['POST'])
def stop():
    try:
        sd.stop()
        return jsonify({ 'ok': True })
    except Exception as e:
        return jsonify({ 'ok': False, 'error': str(e) })

@app.route('/status', methods=['GET'])
def status():
    return jsonify({
        'ok':     True,
        'engine': 'elevenlabs' if elevenlabs_client else 'piper',
        'voice':  ELEVENLABS_VOICE if elevenlabs_client else 'lessac-medium',
        'device': AUDIO_DEVICE,
    })

# ── START ─────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    engine = 'ElevenLabs (Daniel)' if elevenlabs_client else 'Piper TTS'
    print(f'[Aibo Voice] Server starting — engine: {engine}')
    print(f'[Aibo Voice] Listening on http://127.0.0.1:5002')
    app.run(host='127.0.0.1', port=5002, debug=False, threaded=True)