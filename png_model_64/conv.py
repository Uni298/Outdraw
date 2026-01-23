import onnx
from onnx import external_data_helper

model = onnx.load("model.onnx", load_external_data=True)
external_data_helper.convert_model_from_external_data(model)
onnx.save(model, "model_single.onnx")

