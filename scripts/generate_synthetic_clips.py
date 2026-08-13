import cv2
import numpy as np
import os

def add_noise(img):
    noise = np.random.randint(-30, 30, img.shape, dtype=np.int16)
    return np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)

def create_synthetic_image(text, color, filename):
    img = np.zeros((720, 1280, 3), dtype=np.uint8)
    img[:] = color
    img = add_noise(img)
    cv2.putText(img, text, (400, 360), cv2.FONT_HERSHEY_SIMPLEX, 3, (255, 255, 255), 5, cv2.LINE_AA)
    cv2.imwrite(filename, img)

def create_synthetic_video(transitions, filename, fps=30, size=(1280, 720)):
    out = cv2.VideoWriter(filename, cv2.VideoWriter_fourcc(*'mp4v'), fps, size)
    for text, color, duration in transitions:
        frames = int(fps * duration)
        for _ in range(frames):
            img = np.zeros((size[1], size[0], 3), dtype=np.uint8)
            img[:] = color
            img = add_noise(img)
            cv2.putText(img, text, (200, 360), cv2.FONT_HERSHEY_SIMPLEX, 2, (255, 255, 255), 4, cv2.LINE_AA)
            out.write(img)
    out.release()


def main():
    os.makedirs('../demo/anchors', exist_ok=True)
    os.makedirs('../demo/clips', exist_ok=True)
    
    print("Generating anchor images...")
    create_synthetic_image("DRY Anchor", (50, 50, 50), '../demo/anchors/dry.jpg')
    create_synthetic_image("DAMP Anchor", (70, 70, 70), '../demo/anchors/damp.jpg')
    create_synthetic_image("WET Anchor", (100, 100, 150), '../demo/anchors/wet.jpg')
    create_synthetic_image("STANDING WATER Anchor", (150, 150, 200), '../demo/anchors/standing_water.jpg')
    
    print("Generating 10 synthetic clips...")
    for i in range(1, 10):
        # Just static clips
        create_synthetic_video(
            [(f"Clip {i} - Damp", (70, 70, 70), 5)],
            f'../demo/clips/clip_{i}.mp4'
        )
    
    # Clip 10 is the wet -> drying -> dry transition
    create_synthetic_video(
        [
            ("WET", (100, 100, 150), 20),
            ("DRYING (transition)", (80, 80, 100), 20),
            ("DRY", (50, 50, 50), 20)
        ],
        '../demo/clips/clip_10_drying_transition.mp4'
    )
    
    print("Done generating synthetic demo assets.")

if __name__ == '__main__':
    main()
