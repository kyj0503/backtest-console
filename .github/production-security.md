# 운영 이미지 보안 업데이트

`main`이 운영 기준이다. 매일 한국 시각 05시 18분에 `Scan running OCI image`가 SSH로 `backtest-fe`의 실제 registry digest를 확인하고 `linux/arm64` 이미지를 검사한다. 각 실행의 요약과 JSON 아티팩트에 HIGH·CRITICAL 항목을 남긴다.

Dependabot이 앱 의존성과 Docker 베이스 이미지의 업데이트 PR을 연다. CI는 테스트, 빌드한 후보 이미지, GHCR에 게시한 정확한 digest를 검사한다. 수정 버전이 있는 HIGH·CRITICAL 항목이 있으면 배포를 중단한다. 매주 월요일 한국 시각 03시 18분에 운영 스테이지의 캐시를 갱신해 배포판 패치도 다시 확인한다.

자동 병합은 동일 저장소에서 Dependabot이 서명한 단일 커밋의 패치 버전 또는 동일 태그 digest 갱신에 적용한다. 허용 파일, PR 대상, CI가 검증한 HEAD와 브랜치 보호 규칙을 확인한 뒤 병합하고 CI/CD를 호출한다. 그 밖의 업데이트는 PR에서 검토한다. 배포가 실패하면 기존 앱 배포 스크립트가 이전 릴리스를 복구한다.
