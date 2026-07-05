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
HF_API_URL = f'https://router.huggingface.co/hf-inference/{MODEL_NAME}'
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
    """检测单张图片"""
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': '没有上传文件'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': '文件名为空'}), 400

    try:
        image_bytes = process_image(file)
        result = call_hf_api(image_bytes)

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
    """批量检测"""
    if 'files' not in request.files:
        return jsonify({'success': False, 'error': '没有上传文件'}), 400

    files = request.files.getlist('files')
    if not files:
        return jsonify({'success': False, 'error': '文件列表为空'}), 400

    results = []
    for file in files:
        try:
            image_bytes = process_image(file)
            result = call_hf_api(image_bytes)
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
    """处理图片：压缩 + 转 JPEG 二进制"""
    image = Image.open(file)
    if image.size[0] > MAX_IMAGE_SIZE[0] or image.size[1] > MAX_IMAGE_SIZE[1]:
        image.thumbnail(MAX_IMAGE_SIZE)
    buffer = BytesIO()
    if image.mode in ('RGBA', 'P'):
        image = image.convert('RGB')
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
