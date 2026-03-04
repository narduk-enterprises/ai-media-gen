#!/usr/bin/env python3
"""
Image Quality Scorer — LAION Aesthetic Predictor
Run on a GPU machine (RunPod, etc.) to score all images in your gallery.

Usage:
  pip install torch torchvision transformers pillow requests
  python score_images.py --url https://ai-media-gen.nard.uk --email you@example.com --password yourpass

This will:
  1. Log in to get a session cookie
  2. Fetch all unscored images from /api/scoring/images
  3. Download each image and score it with CLIP + LAION Aesthetic Predictor
  4. Upload scores back via /api/scoring/update in batches
"""

import argparse
import io
import sys
import time
from typing import Optional

import requests
import torch
import torch.nn as nn
from PIL import Image
from transformers import CLIPModel, CLIPProcessor


# ─── LAION Aesthetic Predictor MLP ─────────────────────────────────────
# Matches the architecture from https://github.com/christophschuhmann/improved-aesthetic-predictor
class AestheticPredictor(nn.Module):
    def __init__(self, input_size: int = 768):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(input_size, 1024),
            nn.Dropout(0.2),
            nn.Linear(1024, 128),
            nn.Dropout(0.2),
            nn.Linear(128, 64),
            nn.Dropout(0.1),
            nn.Linear(64, 16),
            nn.Linear(16, 1),
        )

    def forward(self, x):
        return self.layers(x)


# ─── Model Loading ─────────────────────────────────────────────────────

def load_models(device: str = "cuda"):
    print("Loading CLIP model (ViT-L/14)...")
    clip_model = CLIPModel.from_pretrained("openai/clip-vit-large-patch14").to(device)
    clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-large-patch14")
    clip_model.eval()

    print("Loading LAION Aesthetic Predictor...")
    aesthetic_model = AestheticPredictor(input_size=768).to(device)

    # Download the pretrained weights
    weights_url = "https://github.com/christophschuhmann/improved-aesthetic-predictor/raw/main/sac%2Blogos%2Bava1-l14-linearMSE.pth"
    print(f"  Downloading weights from GitHub...")
    weights_data = requests.get(weights_url).content
    state_dict = torch.load(io.BytesIO(weights_data), map_location=device, weights_only=True)
    aesthetic_model.load_state_dict(state_dict)
    aesthetic_model.eval()

    print("Models loaded!\n")
    return clip_model, clip_processor, aesthetic_model


# ─── Scoring ───────────────────────────────────────────────────────────

@torch.no_grad()
def score_image(
    image: Image.Image,
    clip_model: CLIPModel,
    clip_processor: CLIPProcessor,
    aesthetic_model: AestheticPredictor,
    device: str = "cuda",
) -> float:
    """Score a single image. Returns a float 1-10."""
    inputs = clip_processor(images=image, return_tensors="pt").to(device)
    image_features = clip_model.get_image_features(**inputs)
    # Normalize
    image_features = image_features / image_features.norm(dim=-1, keepdim=True)
    score = aesthetic_model(image_features).item()
    # Clamp to 1-10 range
    return max(1.0, min(10.0, score))


# ─── API Client ────────────────────────────────────────────────────────

class MediaGenClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()

    def login(self, email: str, password: str) -> bool:
        resp = self.session.post(
            f"{self.base_url}/api/auth/login",
            json={"email": email, "password": password},
        )
        if resp.status_code == 200:
            print(f"Logged in as {email}")
            return True
        else:
            print(f"Login failed: {resp.status_code} {resp.text}")
            return False

    def get_unscored_images(self) -> list[dict]:
        resp = self.session.get(
            f"{self.base_url}/api/scoring/images",
            params={"scored": "false"},
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("items", [])

    def download_image(self, url: str) -> Optional[Image.Image]:
        """Download an image from the API."""
        if url.startswith("/"):
            url = f"{self.base_url}{url}"
        try:
            resp = self.session.get(url, timeout=30)
            resp.raise_for_status()
            return Image.open(io.BytesIO(resp.content)).convert("RGB")
        except Exception as e:
            print(f"  ⚠ Failed to download: {e}")
            return None

    def submit_scores(self, scores: list[dict]) -> dict:
        resp = self.session.post(
            f"{self.base_url}/api/scoring/update",
            json={"scores": scores},
        )
        resp.raise_for_status()
        return resp.json()


# ─── Main ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Score images with LAION Aesthetic Predictor")
    parser.add_argument("--url", required=True, help="Base URL of your ai-media-gen instance")
    parser.add_argument("--email", required=True, help="Login email")
    parser.add_argument("--password", required=True, help="Login password")
    parser.add_argument("--batch-size", type=int, default=25, help="Upload scores in batches of N")
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()

    print(f"Device: {args.device}")
    print(f"Target: {args.url}\n")

    # Login
    client = MediaGenClient(args.url)
    if not client.login(args.email, args.password):
        sys.exit(1)

    # Fetch unscored images
    print("\nFetching unscored images...")
    items = client.get_unscored_images()
    print(f"Found {len(items)} unscored images\n")

    if not items:
        print("Nothing to score!")
        return

    # Load models
    clip_model, clip_processor, aesthetic_model = load_models(args.device)

    # Score images
    scores: list[dict] = []
    start = time.time()

    for i, item in enumerate(items, 1):
        img = client.download_image(item["url"])
        if img is None:
            continue

        score = score_image(img, clip_model, clip_processor, aesthetic_model, args.device)
        scores.append({"id": item["id"], "score": round(score, 3)})

        elapsed = time.time() - start
        rate = i / elapsed if elapsed > 0 else 0
        print(f"  [{i}/{len(items)}] {score:.2f}  ({rate:.1f} img/s)  {item['id'][:8]}...")

        # Upload in batches
        if len(scores) >= args.batch_size:
            print(f"  → Uploading {len(scores)} scores...")
            result = client.submit_scores(scores)
            print(f"    Updated {result.get('updated', 0)}")
            scores = []

    # Upload remaining
    if scores:
        print(f"  → Uploading final {len(scores)} scores...")
        result = client.submit_scores(scores)
        print(f"    Updated {result.get('updated', 0)}")

    elapsed = time.time() - start
    print(f"\nDone! Scored {len(items)} images in {elapsed:.1f}s ({len(items)/elapsed:.1f} img/s)")


if __name__ == "__main__":
    main()
