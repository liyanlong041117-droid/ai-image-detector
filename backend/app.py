from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
import requests
from io import BytesIO
from PIL import Image
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

app = Flask(__name__)
CORS(app)

# 配置
MODEL_NAME = 'dima806/ai_vs_real_image_detection'
HF_API_URL = f'https://router.huggingface.co/hf-inference/models/{MODEL_NAME}'
HF_API_KEY = os.getenv('HUGGINGFACE_API_KEY', '')
MAX_IMAGE_SIZE = (1024, 1024)
JPEG_QUALITY = 85

# 前端静态文件目录
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend')


@app.route('/')
def index():
    """返回前端页面"""
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/<path:filename>')
def serve_static(filename):
    """返回静态文件（CSS/JS/图片等）"""
    return send_from_directory(FRONTEND_DIR, filename)


@app.route('/api/detect', methods=['POST'])
def detect_image():
    """检测单张图片（启用 TTA）"""
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': '没有上传文件'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': '文件名为空'}), 400

    try:
        # process_image 现在返回 PIL Image
        image = process_image(file)
        
        # 使用 TTA 检测
        result = detect_single_with_tta(image)

        # 如果模型正在加载，返回特殊状态码 202，前端会轮询
        if result.get('status') == 'model_loading':
            return jsonify(result), 202

        return jsonify(result)

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'isAIGenerated': False,
            'confidence': 0,
            'aiProbability': 0,
            'realProbability': 0
        }), 500


@app.route('/api/detect/batch', methods=['POST'])
def detect_batch():
    """批量检测（启用 TTA）"""
    if 'files' not in request.files:
        return jsonify({'success': False, 'error': '没有上传文件'}), 400

    files = request.files.getlist('files')
    if not files:
        return jsonify({'success': False, 'error': '文件列表为空'}), 400

    results = []
    for file in files:
        try:
            # process_image 现在返回 PIL Image
            image = process_image(file)
            
            # 使用 TTA 检测
            result = detect_single_with_tta(image)
            
            # 批量模式下，如果模型加载中，标记后继续（不阻塞）
            if result.get('status') == 'model_loading':
                result['success'] = False
                result['error'] = '模型正在加载，请稍后单独重试该图片'
            results.append(result)
        except Exception as e:
            results.append({
                'success': False,
                'error': str(e),
                'isAIGenerated': False,
                'confidence': 0,
                'aiProbability': 0,
                'realProbability': 0
            })

    return jsonify({'results': results})


@app.route('/api/health')
def health_check():
    """健康检查"""
    return jsonify({
        'status': 'healthy',
        'model': MODEL_NAME,
        'inference': 'huggingface_api'
    })


def process_image(file):
    """
    处理图片：压缩 + 转 RGB
    返回 PIL Image 对象（用于 TTA 变换）
    """
    image = Image.open(file)
    if image.size[0] > MAX_IMAGE_SIZE[0] or image.size[1] > MAX_IMAGE_SIZE[1]:
        image.thumbnail(MAX_IMAGE_SIZE, Image.Resampling.LANCZOS)
    if image.mode in ('RGBA', 'P'):
        image = image.convert('RGB')
    return image


def image_to_bytes(image):
    """将 PIL Image 转为 JPEG 格式的 bytes（用于 API 调用）"""
    buffer = BytesIO()
    image.save(buffer, format='JPEG', quality=JPEG_QUALITY)
    return buffer.getvalue()


def call_hf_api(image_bytes):
    """
    调用 Hugging Face Inference API
    直接发送图片二进制（application/octet-stream）
    返回标准结果格式，如果模型正在加载则 status='model_loading'
    """
    hf_headers = {
        'Authorization': f'Bearer {HF_API_KEY}',
        'Content-Type': 'application/octet-stream'
    }

    try:
        hf_response = requests.post(
            HF_API_URL,
            headers=hf_headers,
            data=image_bytes,   # 直接发二进制，不用 base64
            timeout=60
        )

        # 模型正在加载（冷启动）
        if hf_response.status_code in (503, 500):
            try:
                error_info = hf_response.json()
            except Exception:
                error_info = {}
            estimated_time = error_info.get('estimated_time', 20)
            return {
                'status': 'model_loading',
                'success': False,
                'error': '模型正在启动，请稍候...',
                'estimatedTime': estimated_time
            }

        hf_response.raise_for_status()
        api_result = hf_response.json()
        print(f"📦 Hugging Face API 返回: {api_result}")
        return parse_api_result(api_result)

    except requests.exceptions.Timeout:
        return {
            'status': 'model_loading',
            'success': False,
            'error': '请求超时，模型可能正在加载',
            'estimatedTime': 30
        }
    except Exception as e:
        return {
            'success': False,
            'error': f'API 调用失败: {str(e)}',
            'isAIGenerated': False,
            'confidence': 0,
            'aiProbability': 0,
            'realProbability': 0
        }


def get_tta_variants(image):
    """
    生成 TTA 变体（4 个版本）
    1. 原图
    2. 水平翻转
    3. 中心裁剪 90% 后缩放回原尺寸
    4. 放大 110% 后中心裁剪
    """
    variants = []

    # 1. 原图
    variants.append(image.copy())

    # 2. 水平翻转
    variants.append(image.transpose(Image.FLIP_LEFT_RIGHT))

    # 3. 中心裁剪 90% 后缩放
    w, h = image.size
    crop_margin_w = int(w * 0.05)
    crop_margin_h = int(h * 0.05)
    cropped = image.crop((crop_margin_w, crop_margin_h, w - crop_margin_w, h - crop_margin_h))
    resized = cropped.resize((w, h), Image.Resampling.LANCZOS)
    variants.append(resized)

    # 4. 放大 110% 后中心裁剪
    zoom = 1.1
    new_w, new_h = int(w * zoom), int(h * zoom)
    zoomed = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = (new_w - w) // 2
    top = (new_h - h) // 2
    cropped_zoom = zoomed.crop((left, top, left + w, top + h))
    variants.append(cropped_zoom)

    return variants


def detect_single_with_tta(image):
    """
    对单张图片进行 TTA 检测
    串行调用 4 次 API（原图 + 3 个变体）
    返回聚合后的结果
    """
    variants = get_tta_variants(image)
    all_results = []

    for idx, variant in enumerate(variants):
        image_bytes = image_to_bytes(variant)
        result = call_hf_api(image_bytes)

        # 如果模型正在加载，直接返回（前端会轮询）
        if result.get('status') == 'model_loading':
            return result

        if result.get('success'):
            all_results.append(result)
        else:
            print(f"⚠️ TTA 变体 {idx + 1} 检测失败: {result.get('error')}")

    if not all_results:
        return {
            'success': False,
            'error': '所有 TTA 变体检测均失败',
            'isAIGenerated': False,
            'confidence': 0,
            'aiProbability': 0,
            'realProbability': 0
        }

    # 聚合结果
    return aggregate_tta_results(all_results)


def aggregate_tta_results(results):
    """
    聚合多次 TTA 检测结果
    对 aiProbability 和 realProbability 取平均后归一化
    """
    total_ai = sum(r.get('aiProbability', 0) for r in results)
    total_real = sum(r.get('realProbability', 0) for r in results)

    # 平均
    avg_ai = total_ai / len(results)
    avg_real = total_real / len(results)

    # 归一化
    total = avg_ai + avg_real
    if total > 0:
        avg_ai = avg_ai / total
        avg_real = avg_real / total
    else:
        avg_ai = 0.5
        avg_real = 0.5

    is_ai = avg_ai > 0.5

    return {
        'success': True,
        'isAIGenerated': is_ai,
        'confidence': max(avg_ai, avg_real),
        'aiProbability': avg_ai,
        'realProbability': avg_real,
        'details': {
            'model': MODEL_NAME,
            'ttaVariants': len(results),
            'rawResults': [r.get('details', {}).get('rawResult') for r in results]
        }
    }


def parse_api_result(api_result):
    """解析 Hugging Face API 返回结果，兼容嵌套列表和字典格式"""
    ai_prob = 0
    real_prob = 0

    print(f"🔍 开始解析结果: {api_result}")

    # 扁平化：处理 [[{...}]]、[{...}]、{...} 等多种格式
    items = []
    if isinstance(api_result, list):
        for item in api_result:
            if isinstance(item, list):
                items.extend(item)
            elif isinstance(item, dict):
                items.append(item)
    elif isinstance(api_result, dict):
        items.append(api_result)

    for item in items:
        if not isinstance(item, dict):
            continue
        label = str(item.get('label', '')).lower()
        score = float(item.get('score', 0))
        print(f"  - 标签: '{label}', 分数: {score}")

        if 'ai' in label or 'fake' in label or 'generated' in label or 'artificial' in label or 'label_0' in label:
            ai_prob = score
        elif 'real' in label or 'human' in label or 'natural' in label or 'authentic' in label or 'label_1' in label:
            real_prob = score

    print(f"📊 解析结果: AI概率={ai_prob}, 真实概率={real_prob}")

    # 归一化
    total = ai_prob + real_prob
    if total > 0:
        ai_prob = ai_prob / total
        real_prob = real_prob / total
    else:
        ai_prob = 0.5
        real_prob = 0.5

    is_ai = ai_prob > 0.5

    return {
        'success': True,
        'isAIGenerated': is_ai,
        'confidence': max(ai_prob, real_prob),
        'aiProbability': ai_prob,
        'realProbability': real_prob,
        'details': {
            'model': MODEL_NAME,
            'rawResult': api_result
        }
    }


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    print(f"""
╔══════════════════════════════════════════════════╗
║       AI 图片检测器 - 后端服务                   ║
║       运行地址: http://0.0.0.0:{port}           ║
╠══════════════════════════════════════════════════╣
║       检测模式: Hugging Face API ☁️              ║
║       使用模型: {MODEL_NAME}                     ║
╚══════════════════════════════════════════════════╝
    """)
    app.run(host='0.0.0.0', port=port, debug=debug)
