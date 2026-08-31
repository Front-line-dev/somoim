# somoim

WebRTC를 이용해 화면·시스템 소리·마이크를 공유하고, 파일 또는 폴더를 브라우저끼리 직접 전송하는 정적 웹 애플리케이션입니다.

## 로컬 실행

```bash
npm ci
npm run dev
```

## GitHub Pages 배포

`main` 브랜치에 푸시하면 `.github/workflows/deploy-pages.yml`이 정적 빌드를 생성하고 GitHub Pages에 배포합니다.

저장소의 **Settings → Pages → Build and deployment → Source**가 **GitHub Actions**로 설정되어 있어야 합니다. 프로젝트 사이트 경로는 `/somoim/`으로 빌드됩니다.

분산 신호 발견에는 Trystero의 Nostr 전략을 사용합니다. 화면과 파일 데이터는 신호망을 통과하지 않고 WebRTC를 통해 피어 간에 직접 전송됩니다.
