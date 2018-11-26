import React from "react";
import {
  Text,
  View,
  Image,
  TouchableWithoutFeedback,
  Vibration,
  Dimensions
} from "react-native";
import { Speech, Camera, Permissions, MediaLibrary } from "expo";
import config from "./config";
import { defaultColors, defaultLabelColors, labelsObject } from "./constants";
const { width } = Dimensions.get("window")


export default class CameraScreen extends React.Component {
  state = {
    hasCameraPermission: null,
    type: Camera.Constants.Type.back,
    flash: Camera.Constants.FlashMode.off,
    pictureUri: null,
    pictureBase64: null,
    pictureTaken: false
  };

  async componentDidMount() {
    this._greeting();
    await Permissions.askAsync(Permissions.CAMERA_ROLL);
    const { status } = await Permissions.askAsync(Permissions.CAMERA);
    this.setState({ hasCameraPermission: status === "granted" });
  }


  render() {
    const { hasCameraPermission, pictureTaken, pictureUri } = this.state;
    if (hasCameraPermission === null) {
      return <View />;
    } else if (hasCameraPermission === false) {
      return (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text>카메라 권한이 없습니다.</Text>
        </View>

      )
    } else {
      return (
        <View style={{ flex: 1, backgroundColor: "black" }}>
          {pictureTaken ? (
            <View style={{ flex: 1, justifyContent: "center" }}>
              <Image source={{ uri: pictureUri }} style={{ width: width, height: width * 4 / 3 }} />
            </View>
          ) : (
              <TouchableWithoutFeedback style={{ flex: 1 }} onPress={this._takePicture}>
                <View style={{ flex: 1, justifyContent: "center" }}>
                  <Camera
                    style={{ width: width, height: width * 4 / 3 }}
                    type={this.state.type}
                    flashMode={this.state.flash}
                    ref={ref => {
                      this.camera = ref;
                    }}
                    whiteBalance={Camera.Constants.WhiteBalance.fluorescent}
                  >
                    <View style={{ position: "absolute", left: 20, top: 20 }}>
                      <Text style={{ color: "white", fontSize: 25, fontWeight: "700" }}>A</Text>
                    </View>
                  </Camera>
                </View>
              </TouchableWithoutFeedback>
            )
          }
        </View>
      );
    }
  }

  _takePicture = async () => {
    const { pictureTaken } = this.state;
    const options = {
      quality: 0.8,
      base64: true
    };
    if (!pictureTaken) {
      if (this.camera) {
        const takenPhoto = await this.camera.takePictureAsync(options);
        this.setState({
          pictureUri: takenPhoto.uri,
          pictureBase64: takenPhoto.base64,
          pictureTaken: true
        });

        // beyes 폴더 따로 만들어서 넣기.
        const asset = await MediaLibrary.createAssetAsync(takenPhoto.uri)
        const beyesAlbum = await MediaLibrary.getAlbumAsync("beyes")

        this._analyzePhoto();

        if (beyesAlbum === null || beyesAlbum === undefined) {
          MediaLibrary.createAlbumAsync("beyes", asset, false).then(() => {
            Speech.speak("저장되었습니다. 색을 분석하는 중입니다.");
          })
        } else {
          MediaLibrary.addAssetsToAlbumAsync(asset, beyesAlbum.id, false).then(() => {
            Speech.speak("저장되었습니다. 색을 분석하는 중입니다.");
          })
        }
      }
    }
  };

  _analyzePhoto = async () => {
    const { pictureBase64 } = this.state;
    fetch(config.googleCloud.api + config.googleCloud.apiKey, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            "image": {
              "content": pictureBase64
            },
            "features": [
              {
                "type": "LABEL_DETECTION"
              },
              {
                "type": "IMAGE_PROPERTIES",
                "maxResults": 5
              },
              {
                "type": "TEXT_DETECTION"
              }
            ]
          }
        ]
      })
    })
      .then(response => response.json())
      .then(data => {
        Vibration.vibrate(500);
        if (
          data.responses[0].textAnnotations === undefined ||
          data.responses[0].textAnnotations.length < 5
        ) {
          // 옷 사진 찍은 경우
          console.log("옷 사진")

          const imageColor1 = data.responses[0].imagePropertiesAnnotation.dominantColors.colors[0];
          const imageColor2 = data.responses[0].imagePropertiesAnnotation.dominantColors.colors[1];
          const imageColor3 = data.responses[0].imagePropertiesAnnotation.dominantColors.colors[2];
          const resultColor = this._compareColors(imageColor1);
          console.log("extracted color", imageColor1)
          if (resultColor) {
            const result = `이 옷의 색깔은 ${resultColor}에 가깝습니다. 새로운 옷을 확인하고 싶으시면 화면을 터치해주세요`;

            // Speech.isSpeakingAsync().then()
            this._rejectPhoto()
            return Speech.speak(result);
          }
        } else {
          // 태그 찍은 경우
          console.log("태그 사진")

          // color가 있는지 없는지 확인   _.isequal 사용.
          const texts = data.responses[0].textAnnotations;
          let textsGroup = [];
          texts.forEach(text => textsGroup.push(text.description.toLowerCase()));
          console.log("textsGroup", textsGroup);

          const resultColor = this._compareLabelColors(textsGroup);
          let result;

          console.log("resultcolor", resultColor)
          if (resultColor === "초록 또는 회색" || resultColor === "파랑 또는 검정" || resultColor === "분홍 또는 보라") {
            result = `이 옷의 색깔은 ${resultColor}에 가깝습니다. 정확한 색 파악을 위해 상표가 아닌 옷 사진을 다시 찍어주세요`;
          } else if (resultColor === "none") {
            result = `색상 정보를 얻을 수 없습니다. 상표가 아닌 옷 사진을 다시 찍어주세요`;
          } else {
            result = `이 옷의 색깔은 ${resultColor}에 가깝습니다. 새로운 옷을 확인하고 싶으시면 화면을 터치해주세요`;
          }

          this._rejectPhoto();
          return Speech.speak(result);
        }
      })
      .catch(e => {
        console.log("error", e.message);
        this._rejectPhoto();
        Speech.speak("사진 분석에 실패했습니다. 다시 촬영해주세요");

      });
  };

  _compareColors = imageColor => {
    let array = [];
    defaultColors.forEach(defaultColor => {
      const distance = this._isClose(imageColor, defaultColor);
      const result = { key: defaultColor.key, distance };
      array.push(result);
    });

    array.sort(function (a, b) {
      return a.distance - b.distance;
    });
    // console.log("array", array);
    return array[0].key;
  };

  _compareLabelColors = takenLabels => {
    const result = takenLabels.filter(e => defaultLabelColors.indexOf(e) !== -1);
    if (result.length != 0) {
      // console.log("label color result", result);
      const firstColor = result[0];
      // console.log("firstColor", firstColor)

      const key = labelsObject[firstColor]
      return key;
    } else {
      return "none";
    }
  };

  _isClose = (imageColor, defaultColor) => {
    const color = imageColor.color;
    const distance =
      Math.abs(color.red - defaultColor.r) +
      Math.abs(color.green - defaultColor.g) +
      Math.abs(color.blue - defaultColor.b);
    return distance;
  };

  _greeting = () => {
    let options = {
      language: "ko-KP",
      pitch: 1,
      rate: 1.0
    };
    Speech.speak(
      "비예스 앱이 실행됩니다. 원활한 사용을 위해 네트워크를 연결해 주십시오. 화면을 터치하여 옷의 라벨 혹은 옷 전체를 찍어주세요",
      options
    );
  };

  _rejectPhoto = () => {
    this.setState({
      pictureTaken: false,
      pictureBase64: null,
      pictureUri: null
    });
  };

}



