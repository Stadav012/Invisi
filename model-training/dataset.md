# Cacao Bean Dataset Info

## Description
Dataset of 3268 images of cacao beans, which included whole beans and their cross-sectional views, resulting in 1634 unique beans. Based on morphological development and fermentation rate, 1261 beans were classified as good quality, while 373 were classified as poor quality. These beans were collected from the La Maná, city of Ecuador, which is known for cocoa cultivation. The dataset was obtained from a realistic production setting, where mixing of healthy and diseased beans and variations in post-harvest processing are common, emphasizing the need for on-site analysis to obtain accurate data.

## Location
**Google Drive Path:** `/content/drive/MyDrive/Cacao_dataset_kaggle/dataset_original_train_val`

## Structure
- **Train:** `/content/drive/MyDrive/Cacao_dataset_kaggle/dataset_original_train_val/train`
- **Val:** `/content/drive/MyDrive/Cacao_dataset_kaggle/dataset_original_train_val/val`

## Classes
- `mala` (poor quality)
- `sana` (good quality)

## Python Configuration
```python
data = {
    'path': '/content/drive/MyDrive/Cacao_dataset_kaggle/dataset_original_train_val',
    'train': 'train', # Train images are in /content/drive/MyDrive/Cacao_dataset_kaggle/dataset_original_train_val/train
    'val': 'val',     # Val images are in /content/drive/MyDrive/Cacao_dataset_kaggle/dataset_original_train_val/val
    'names': ['mala', 'sana'] # Class names
}
```
