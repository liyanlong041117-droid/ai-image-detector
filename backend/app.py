from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import base64
import os
import random
from io import BytesIO
from PIL import Image
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

app = Flask(__name__)
CORS(app)

# 配置
HUGGINGFACE_TOKEN = os.getenv('HUGGINGFACE_API_KEY', '')
MODEL_NAME = 'Falconsai/ai_vs_real_image_detection'
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
        result = process_and_detect(file)
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
            result = process_and_detect(file)
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
        'huggingface_configured': bool(HUGGINGFACE_TOKEN)
    })


def process_and_detect(file):
    """处理图片并检测"""
    # 1. 打开图片
    image = Image.open(file)

    # 2. 压缩图片（限制尺寸）
    if image.size[0] > MAX_IMAGE_SIZE[0] or image.size[1] > MAX_IMAGE_SIZE[1]:
        image.thumbnail(MAX_IMAGE_SIZE)

    # 3. 转为 Base64
    buffer = BytesIO()
    # 统一转 RGB（某些图片可能是 RGBA/灰度）
    if image.mode in ('RGBA', 'P'):
        image = image.convert('RGB')
    image.save(buffer, format='JPEG', quality=JPEG_QUALITY)
    image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

    # 4. 调用检测
    if HUGGINGFACE_TOKEN:
        return call_huggingface_api(image_base64)
    else:
        return simulate_detection()


def call_huggingface_api(image_base64):
    """调用 Hugging Face API"""
    try:
        response = requests.post(
            f'https://api-inference.huggingface.co/models/{MODEL_NAME}',
            headers={
                'Authorization': f'Bearer {HUGGINGFACE_TOKEN}',
                'Content-Type': 'application/json'
            },
            json={'inputs': image_base64},
            timeout=30
        )

        if response.status_code == 503:
            # 模型正在加载，等待重试
            estimated_time = response.json().get('estimated_time', 20)
            return {
                'success': False,
                'error': f'模型正在加载，预计等待 {estimated_time} 秒，请重试',
                'isAIGenerated': False,
                'confidence': 0,
                'aiProbability': 0,
                'realProbability': 0
            }

        if response.status_code != 200:
            return {
                'success': False,
                'error': f'API 返回错误 (状态码: {response.status_code})',
                'isAIGenerated': False,
                'confidence': 0,
                'aiProbability': 0,
                'realProbability': 0
            }

        api_result = response.json()
        return parse_api_result(api_result)

    except requests.exceptions.Timeout:
        return {
            'success': False,
            'error': 'API 调用超时，请重试',
            'isAIGenerated': False,
            'confidence': 0,
            'aiProbability': 0,
            'realProbability': 0
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
    """解析 Hugging Face API 返回结果"""
    ai_prob = 0
    real_prob = 0

    if isinstance(api_result, list):
        for item in api_result:
            label = item.get('label', '').lower()
            score = item.get('score', 0)
            if 'ai' in label or 'fake' in label or 'generated' in label:
                ai_prob = score
            elif 'real' in label or 'human' in label or 'natural' in label:
                real_prob = score

    # 归一化
    total = ai_prob + real_prob
    if total > 0:
        ai_prob = ai_prob / total
        real_prob = real_prob / total
    else:
        # 如果解析不到，给个默认值
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


def simulate_detection():
    """模拟检测（用于演示或无 Token 时的降级）"""
    ai_prob = random.uniform(0.25, 0.85)
    real_prob = 1 - ai_prob
    is_ai = ai_prob > 0.5

    return {
        'success': True,
        'isAIGenerated': is_ai,
        'confidence': max(ai_prob, real_prob),
        'aiProbability': ai_prob,
        'realProbability': real_prob,
        'details': {
            'model': 'simulation',
            'warning': '此为模拟结果。请配置 HUGGINGFACE_API_KEY 环境变量以连接真实检测模型。'
        }
    }


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    print(f"""
╔══════════════════════════════════════════╗
║     AI 图片检测器 - 后端服务             ║
║     运行地址: http://0.0.0.0:{port}   ║
╠══════════════════════════════════════════╣
║     HuggingFace 状态: {'已配置 ✅' if HUGGINGFACE_TOKEN else '未配置 ⚠️ (将使用模拟检测)'}  ║
╚══════════════════════════════════════════╝
    """)
    app.run(host='0.0.0.0', port=port, debug=debug)
