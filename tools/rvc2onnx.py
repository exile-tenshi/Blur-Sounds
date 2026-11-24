"""Convert an RVC v2 voice (.pth, 32k/40k/48k, with pitch) to the ONNX format Blur Sounds Pro's voice changer loads.

Usage (needs Python 3.10+, torch, numpy, onnx and a clone of the RVC WebUI repo for its model code):
    git clone https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI rvc
    pip install torch numpy onnx
    python rvc2onnx.py my_voice.pth my_voice.onnx --rvc ./rvc

Writes my_voice.onnx and my_voice.spk (speaker table). Import the .onnx on the Voice page; keep the .spk next to it.
Only convert voices you have the right to use (your own voice, or one whose owner allows it).
"""
import argparse, sys, os, numpy as np, torch, torch.nn as nn, torch.nn.functional as F

ap = argparse.ArgumentParser(); ap.add_argument('pth'); ap.add_argument('out'); ap.add_argument('--rvc', default='rvc')
a = ap.parse_args(); sys.path.insert(0, a.rvc)
try: from infer.lib.infer_pack.models import SynthesizerTrnMs768NSFsid; from infer.lib.infer_pack import attentions as A, models as M
except ImportError: from infer.module.models import SynthesizerTrnMs768NSFsid; from infer.module import attentions as A, models as M

# ONNX-friendly relative attention (dynamic length) and a deterministic noise source (no random ops in the graph).
_P = 4096
def _gre(self, rel, length): w = self.window_size; p = F.pad(rel, [0, 0, _P, _P, 0, 0]); return p[:, _P + w - length + 1:_P + w + length]
def _r2a(self, x):
    b, h, l, _ = x.size(); x = F.pad(x, [0, 1, 0, 0, 0, 0, 0, 0]); xf = F.pad(x.reshape(b, h, l * 2 * l), [0, l - 1, 0, 0, 0, 0])
    return xf.reshape(b, h, l + 1, 2 * l - 1)[:, :, :l, l - 1:]
def _a2r(self, x):
    b, h, l, _ = x.size(); x = F.pad(x, [0, l - 1, 0, 0, 0, 0, 0, 0]); xf = F.pad(x.reshape(b, h, l * l + l * (l - 1)), [l, 0, 0, 0, 0, 0])
    return xf.reshape(b, h, l, 2 * l)[:, :, :, 1:]
A.MultiHeadAttention._get_relative_embeddings = _gre; A.MultiHeadAttention._relative_position_to_absolute_position = _r2a; A.MultiHeadAttention._absolute_position_to_relative_position = _a2r
def _f02sine(self, f0, upp):
    rad = f0 / self.sampling_rate * torch.arange(1, upp + 1, device=f0.device)
    rad2 = torch.fmod(rad[..., -1:].float() + 0.5, 1.0) - 0.5
    rad += F.pad(rad2.cumsum(dim=1).fmod(1.0).to(f0), (0, 0, 1, -1))
    rad = rad.reshape(f0.shape[0], -1, 1) * torch.arange(1, self.dim + 1, device=f0.device).reshape(1, 1, -1)
    return torch.sin(2 * np.pi * rad)
def _sg_forward(self, f0, upp):
    f0 = f0[:, None].transpose(1, 2); sine = self._f02sine(f0, upp) * self.sine_amp; uv = self._f02uv(f0)
    uv = F.interpolate(uv.transpose(2, 1), scale_factor=float(upp), mode='nearest').transpose(2, 1)
    amp = uv * self.noise_std + (1 - uv) * self.sine_amp / 3; L = sine.shape[1]
    i = torch.arange(L).float().reshape(1, -1, 1) + torch.arange(self.dim).float().reshape(1, 1, -1) * 7919.0
    v = torch.sin(torch.fmod(i, 65521.0) * 12.9898 + 0.137) * 43758.5453; u = v - torch.floor(v)
    n = amp * (u - 0.5) * 3.4641; return sine * uv + n, uv, n
M.SineGen._f02sine = _f02sine; M.SineGen.forward = _sg_forward

class Gen(nn.Module):
    def __init__(s, g): super().__init__(); s.g = g
    def forward(s, phone, phone_lengths, pitch, nsff0, spk, rnd, skip_head):
        g = s.g; gg = spk.unsqueeze(-1); m_p, logs_p, x_mask = g.enc_p(phone, pitch, phone_lengths)
        z = g.flow((m_p + torch.exp(logs_p) * rnd * 0.66666) * x_mask, x_mask, g=gg, reverse=True)
        T = z.shape[2]; idx = torch.arange(T - skip_head[0]) + skip_head[0]
        return g.dec(torch.index_select(z, 2, idx), torch.index_select(nsff0, 1, idx), g=gg)

c = torch.load(a.pth, map_location='cpu', weights_only=False)
if c.get('version', 'v2') != 'v2' or not c.get('f0', 1): sys.exit('Only RVC v2 voices with pitch (f0) are supported.')
cfg = list(c['config']); cfg[-3] = c['weight']['emb_g.weight'].shape[0]
g = SynthesizerTrnMs768NSFsid(*cfg, is_half=False); del g.enc_q
g.load_state_dict({k: v.float() for k, v in c['weight'].items() if not k.startswith('enc_q')}, strict=False); g.eval(); g.remove_weight_norm()
if cfg[-1] not in (32000, 40000, 48000): sys.exit(f'unsupported sample rate {cfg[-1]}')
emb = g.emb_g.weight.detach().numpy().astype(np.float32); emb.tofile(os.path.splitext(a.out)[0] + '.spk')
T = 200; args = (torch.randn(1, T, 768), torch.tensor([T]), torch.randint(1, 255, (1, T)), torch.rand(1, T) * 300 + 100, torch.from_numpy(emb[:1]), torch.randn(1, 192, T), torch.tensor([50]))
torch.onnx.export(Gen(g).eval(), args, a.out, input_names=['phone', 'phone_lengths', 'pitch', 'nsff0', 'spk', 'rnd', 'skip_head'], output_names=['audio'],
    dynamic_axes={'phone': {1: 'T'}, 'pitch': {1: 'T'}, 'nsff0': {1: 'T'}, 'rnd': {2: 'T'}, 'audio': {2: 'S'}}, opset_version=17, dynamo=False)
print('wrote', a.out, 'and', os.path.splitext(a.out)[0] + '.spk')
