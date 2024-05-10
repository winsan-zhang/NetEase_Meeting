import { EventPriority, XKitReporter } from '@xkit-yx/utils'
import WebRoomkit from 'neroom-web-sdk'
import { useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IPCEvent } from '../../app/src/types'
import { errorCodeMap } from '../config'
import NEMeetingService from '../services/NEMeeting'
import {
  MeetingInfoContext,
  useGlobalContext,
  useWaitingRoomContext,
} from '../store'
import {
  ActionType,
  AttendeeOffType,
  CreateOptions,
  EventType,
  GetMeetingConfigResponse,
  JoinOptions,
  LoginOptions,
  MeetingEventType,
  MeetingInfoContextInterface,
  StaticReportType,
} from '../types'
import {
  memberAction,
  NERoomBeautyEffectType,
  tagNERoomRtcAudioProfileType,
  tagNERoomRtcAudioScenarioType,
  UserEventType,
} from '../types/innerType'
import {
  MoreBarList,
  NEMeetingCode,
  NEMeetingSDKInfo,
  NEMeetingStatus,
  Role,
  ToolBarList,
} from '../types/type'
import { getLocalStorageSetting } from '../utils'
import { IntervalEvent } from '../utils/report'
import Modal from './common/Modal'
import Toast from './common/toast'
import Dialog from './h5/ui/dialog'
interface AuthProps {
  renderCallback?: () => void
}

const IM_VERSION = '9.11.0'
const RTC_VERSION = '5.4.0'
const Auth: React.FC<AuthProps> = ({ renderCallback }) => {
  const {
    outEventEmitter,
    eventEmitter,
    neMeeting,
    dispatch: globalDispatch,
  } = useGlobalContext()
  const [passwordDialogShow, setPasswordDialogShow] = useState(false)
  const [password, setPassword] = useState('')
  const passwordRef = useRef('')
  const [isAnonymousLogin, setIsAnonymousLogin] = useState(false) // 匿名登录模式
  const joinOptionRef = useRef<JoinOptions | undefined>(undefined)
  const [errorText, setErrorText] = useState('')
  // 加入或者创建回调
  const callbackRef = useRef<any>(null)
  const { t } = useTranslation()
  const { dispatch, memberList } =
    useContext<MeetingInfoContextInterface>(MeetingInfoContext)
  const { dispatch: waitingRoomDispatch } = useWaitingRoomContext()
  const xkitReportRef = useRef<XKitReporter | null>(null)
  const rejoinCountRef = useRef(0)
  const [isJoining, setIsJoining] = useState(false) // 是否正在加入会议

  useEffect(() => {
    try {
      xkitReportRef.current = XKitReporter.getInstance({
        imVersion: IM_VERSION,
        nertcVersion: RTC_VERSION,
        deviceId: WebRoomkit.getDeviceId(),
      })
      xkitReportRef.current.common.appName = document?.title
    } catch (e) {
      console.warn('xkit', e)
    }
    outEventEmitter?.on(
      UserEventType.LoginWithPassword,
      (data: {
        options: { username: string; password: string }
        callback: (e?: any) => void
      }) => {
        const { options, callback } = data
        callbackRef.current = callback
        loginWithPassword(options.username, options.password)
          .then(() => {
            callback && callback()
          })
          .catch((e) => {
            callback && callback(e)
          })
      }
    )

    outEventEmitter?.on(
      UserEventType.Login,
      (data: { options: LoginOptions; callback: (e?: any) => void }) => {
        const { options, callback } = data
        login(options)
          .then(() => {
            callback && callback()
          })
          .catch((e) => {
            callback && callback(e)
          })
      }
    )

    outEventEmitter?.on(
      UserEventType.Logout,
      (data: { callback: (e?: any) => void }) => {
        const { callback } = data
        logout()
          .then(() => {
            callback && callback()
          })
          .catch((e) => {
            callback && callback(e)
          })
      }
    )

    outEventEmitter?.on(UserEventType.UpdateMeetingInfo, (data) => {
      console.log('updateMeetingInfo', data)
      dispatch?.({
        type: ActionType.UPDATE_MEETING_INFO,
        data,
      })
    })

    outEventEmitter?.on(
      UserEventType.CreateMeeting,
      (data: { options: CreateOptions; callback: (e?: any) => void }) => {
        const { options, callback } = data
        callbackRef.current = callback
        joinOptionRef.current = options
        createMeeting(options)
          .then(() => {
            callback && callback()
          })
          .catch((e) => {
            callback && callback(e)
          })
      }
    )
    eventEmitter?.on(UserEventType.CancelJoin, () => {
      outEventEmitter?.emit(
        UserEventType.onMeetingStatusChanged,
        NEMeetingStatus.MEETING_STATUS_IDLE
      )
    })
    eventEmitter?.on(
      UserEventType.JoinOtherMeeting,
      (data: JoinOptions, callback) => {
        const options = { ...joinOptionRef.current, ...data }
        setPasswordDialogShow(false)
        joinMeetingHandler({
          options,
          callback,
          isJoinOther: true,
        })
      }
    )
    eventEmitter?.on(
      UserEventType.RejoinMeeting,
      (data: { isAudioOn: boolean; isVideoOn: boolean }) => {
        if (joinOptionRef.current) {
          joinOptionRef.current.audio = data.isAudioOn ? 1 : 2
          joinOptionRef.current.video = data.isVideoOn ? 1 : 2
        }
        const options = {
          ...joinOptionRef.current,
          password: passwordRef.current,
        }
        setPasswordDialogShow(false)
        if (isAnonymousLogin) {
          outEventEmitter?.emit(UserEventType.AnonymousJoinMeeting, {
            options,
            callback: callbackRef.current,
            isRejoin: true,
          })
        } else {
          outEventEmitter?.emit(UserEventType.JoinMeeting, {
            options,
            callback: callbackRef.current,
            isRejoin: true,
          })
        }
      }
    )
    outEventEmitter?.on(
      UserEventType.SetScreenSharingSourceId,
      (sourceId: string) => {
        neMeeting?.setScreenSharingSourceId(sourceId)
      }
    )
    outEventEmitter?.on(
      UserEventType.JoinMeeting,
      (data: {
        options: JoinOptions
        callback: any
        isRejoin?: boolean
        type: 'join' | 'joinByInvite'
      }) => {
        joinMeetingHandler(data)
      }
    )
    outEventEmitter?.on(
      UserEventType.AnonymousJoinMeeting,
      (data: { options: JoinOptions; callback: any; isRejoin?: boolean }) => {
        setIsJoining(true)
        const { options, callback } = data
        callbackRef.current = callback
        anonymousJoin(options, data.isRejoin)
          .then(() => {
            // 断网重新入会不需要触发回调
            if (data.isRejoin) {
              return
            }
            callback && callback()
          })
          .catch((e) => {
            if (data.isRejoin) {
              handleRejoinFailed()
              return
            }
            callback && callback(e)
          })
          .finally(() => {
            setIsJoining(false)
          })
      }
    )
    outEventEmitter?.on(
      MeetingEventType.rejoinAfterAdmittedToRoom,
      (data: { isUnMutedVideo: boolean; isUnMutedAudio: boolean }) => {
        handleJoinSuccess(joinOptionRef.current as JoinOptions, data)
      }
    )
    try {
      // neMeeting?.getGlobalConfig().then((res) => {
      //   updateGlobalConfig({ globalConfig: res })
      // })
      renderCallback && renderCallback()
    } catch (e) {
      console.warn('renderCallback failed', e)
    }
  }, [])

  function joinMeetingHandler(data: {
    options: JoinOptions
    callback: any
    isRejoin?: boolean
    isJoinOther?: boolean
  }) {
    setIsJoining(true)
    const { options, callback } = data
    callbackRef.current = callback
    dispatch?.({
      type: ActionType.RESET_MEMBER,
      data: null,
    })
    dispatch &&
      dispatch({
        type: ActionType.RESET_MEETING,
        data: null,
      })
    joinMeeting(options, data.isJoinOther, data.isRejoin)
      .then(() => {
        if (data.isRejoin) {
          return
        }
        callback && callback()
      })
      .catch((e) => {
        if (data.isRejoin) {
          // 会议已被锁定或者已结束、被加入黑名单
          if (e.code === 1019 || e.code == 3102 || e.code === 601011) {
            setTimeout(() => {
              outEventEmitter?.emit(
                UserEventType.onMeetingStatusChanged,
                NEMeetingStatus.MEETING_STATUS_FAILED
              )
            }, 1000)

            return
          }
          handleRejoinFailed()
          return
        }
        callback && callback(e)
      })
      .finally(() => {
        setIsJoining(false)
      })
  }
  function handleRejoinFailed() {
    rejoinCountRef.current += 1
    console.log('rejoinCountRef.current', rejoinCountRef.current)

    if (rejoinCountRef.current > 3) {
      rejoinCountRef.current = 0
      eventEmitter?.emit(EventType.RoomEnded, 'LEAVE_BY_SELF')
      dispatch?.({
        type: ActionType.RESET_MEETING,
        data: null,
      })
      return
    }

    globalDispatch?.({
      type: ActionType.UPDATE_GLOBAL_CONFIG,
      data: {
        waitingRejoinMeeting: true,
      },
    })
    return
  }

  useEffect(() => {
    setErrorText('')
  }, [password])

  const login = (options: LoginOptions): Promise<void> => {
    const loginReport = new IntervalEvent({
      eventId: StaticReportType.MeetingKit_login,
      priority: EventPriority.HIGH,
    })
    try {
      loginReport.addParams({ type: 'token' })
    } catch (e) {}
    return (neMeeting as NEMeetingService)
      .login({
        loginType: 1,
        loginReport: loginReport,
        ...options,
      })
      .then((res) => {
        try {
          loginReport.endWithSuccess()
          xkitReportRef.current?.reportEvent(loginReport)
          neMeeting
            ?.getGlobalConfig()
            .then((res) => {
              updateGlobalConfig({ globalConfig: res })
            })
            .catch((e) => {
              console.log('getGlobalConfig error', e)
            })
        } catch (e) {}
      })
      .catch((e) => {
        loginReport.endWith({
          code: e.code || -1,
          msg: e.msg || e.message || 'failure',
          requestId: e.requestId,
        })
        xkitReportRef.current?.reportEvent(loginReport)
        throw e
      })
  }

  const logout = (): Promise<void> => {
    return (neMeeting as NEMeetingService).logout()
  }

  const loginWithPassword = (
    username: string,
    password: string
  ): Promise<void> => {
    const loginReport = new IntervalEvent({
      eventId: StaticReportType.MeetingKit_login,
      priority: EventPriority.HIGH,
    })
    try {
      loginReport.addParams({ type: 'password' })
    } catch (e) {}
    return (neMeeting as NEMeetingService)
      .login({
        username,
        password,
        loginType: 2,
        loginReport,
      })
      .then((res) => {
        try {
          loginReport.endWithSuccess()
          xkitReportRef.current?.reportEvent(loginReport)
        } catch (e) {}
      })
      .catch((e) => {
        loginReport.endWith({
          code: e.code || -1,
          msg: e.msg || e.message || 'failure',
          requestId: e.requestId,
        })
        xkitReportRef.current?.reportEvent(loginReport)
        throw e
      })
  }
  const createMeeting = (options: CreateOptions): Promise<void> => {
    const createMeetingReport = new IntervalEvent({
      eventId: StaticReportType.MeetingKit_start_meeting,
      priority: EventPriority.HIGH,
    })
    globalDispatch?.({
      type: ActionType.JOIN_LOADING,
      data: true,
    })
    createMeetingReport.addParams({
      type: options.meetingNum ? 'personal' : 'random',
      meetingNum: options.meetingNum,
    })
    return (neMeeting as NEMeetingService)
      .create({ ...options, createMeetingReport: createMeetingReport })
      .then(() => {
        try {
          createMeetingReport.endWithSuccess()
          xkitReportRef.current?.reportEvent(createMeetingReport)
        } catch (e) {}
        handleJoinSuccess(options)
      })
      .catch((e) => {
        createMeetingReport.endWith({
          code: e.code || -1,
          msg: e.msg || e.message || 'failure',
          requestId: e.requestId,
        })
        xkitReportRef.current?.reportEvent(createMeetingReport)
        handleJoinFail(e, options)
        return Promise.reject(e)
      })
  }

  // 加入成功
  const handleJoinSuccess = (
    options: JoinOptions,
    waitingRoomOptions?: {
      isUnMutedVideo: boolean
      isUnMutedAudio: boolean
    }
  ) => {
    outEventEmitter?.emit(
      UserEventType.onMeetingStatusChanged,
      NEMeetingStatus.MEETING_STATUS_INMEETING
    )
    joinOptionRef.current = options

    updateGlobalConfig({
      showSubject: !!options.showSubject,
      showMeetingRemainingTip: !!options.showMeetingRemainingTip,
      toolBarList: options.toolBarList || [],
      moreBarList: options.moreBarList || [],
      waitingJoinOtherMeeting: false,
      // @ts-ignore
    })

    hideLoadingPage()
    // dispatch &&
    //   dispatch({
    //     type: ActionType.UPDATE_MEETING_INFO,
    //     data: {
    //       isUnMutedVideo: options.video === 1,
    //       isUnMutedAudio: options.audio === 1,
    //     },
    //   })
    handleMeetingInfo(waitingRoomOptions)

    if (neMeeting?.subscribeMembersMap) {
      neMeeting.subscribeMembersMap = {}
    }

    globalDispatch?.({
      type: ActionType.UPDATE_GLOBAL_CONFIG,
      data: {
        waitingRejoinMeeting: false,
        waitingJoinOtherMeeting: false,
        online: true,
        meetingIdDisplayOption: options.meetingIdDisplayOption
          ? options.meetingIdDisplayOption
          : 0,
        showCloudRecordingUI:
          options.showCloudRecordingUI === false ? false : true,
        showScreenShareUserVideo:
          options.showScreenShareUserVideo === false ? false : true,
        showCloudRecordMenuItem:
          options.showCloudRecordMenuItem === false ? false : true,
      },
    })
    rejoinCountRef.current = 0
  }

  function handleMeetingInfo(data?: {
    isUnMutedVideo: boolean
    isUnMutedAudio: boolean
  }) {
    const options = joinOptionRef.current as JoinOptions
    const meeting = neMeeting?.getMeetingInfo()
    const setting = getLocalStorageSetting()
    if (setting) {
      dispatch?.({
        type: ActionType.UPDATE_MEETING_INFO,
        data: {
          setting,
        },
      })
    }
    if (meeting && meeting.meetingInfo) {
      if (joinOptionRef.current) {
        joinOptionRef.current.meetingNum = meeting.meetingInfo.meetingNum
      }
      const meetingInfo = meeting.meetingInfo
      const memberList = meeting.memberList
      const hostMember = memberList.find((member) => member.role === Role.host)
      if (
        hostMember &&
        hostMember?.uuid !== meetingInfo.localMember.uuid &&
        meetingInfo.localMember.uuid === meetingInfo.ownerUserUuid
      ) {
        Modal.confirm({
          key: 'takeBackTheHost',
          title: t('meetingReclaimHostTip', { user: hostMember.name }),
          okText: t('meetingReclaimHost'),
          cancelText: t('meetingReclaimHostCancel'),
          onOk: async () => {
            try {
              await neMeeting?.sendMemberControl(
                memberAction.takeBackTheHost,
                hostMember.uuid
              )
            } catch {
              Toast.fail(t('meetingReclaimHostFailed'))
            }
          },
        })
      }
      if (meetingInfo.localMember.role === Role.coHost) {
        Toast.info(t('participantAssignedCoHost'))
      } else if (
        meetingInfo.localMember.role === Role.host &&
        neMeeting?._meetingInfo.ownerUserUuid !== meetingInfo.localMember.uuid
      ) {
        Toast.info(t('participantAssignedHost'))
      }

      const whiteboardUuid = meetingInfo.whiteboardUuid
      if (!whiteboardUuid && joinOptionRef.current?.defaultWindowMode === 2) {
        neMeeting?.roomContext
          ?.updateRoomProperty(
            'whiteboardConfig',
            JSON.stringify({
              isTransparent: joinOptionRef.current?.enableTransparentWhiteboard,
            })
          )
          .then(() => {
            return neMeeting?.whiteboardController?.startWhiteboardShare()
          })
      } else if (whiteboardUuid) {
        if (whiteboardUuid === meetingInfo.localMember.uuid) {
          // 如果加入会议时候发现白板共享id和本端是一致的则表示共享的时候互踢如何，需要重置白板为关闭
          neMeeting?.whiteboardController?.stopWhiteboardShare()
          meeting.meetingInfo.whiteboardUuid = ''
        }
        if (joinOptionRef.current?.defaultWindowMode === 2) {
          Toast.info(t('screenShareNotAllow'))
        }
      }
      // 入会如果房间不允许开启视频则需要提示
      if (
        (meetingInfo.videoOff.startsWith(AttendeeOffType.offNotAllowSelfOn) ||
          meetingInfo.videoOff.startsWith(AttendeeOffType.offAllowSelfOn)) &&
        meetingInfo.hostUuid !== meetingInfo.localMember.uuid &&
        options.video === 1 &&
        !meetingInfo.localMember.hide &&
        !meetingInfo.inWaitingRoom
      ) {
        Toast.info(t('participantHostMuteAllVideo'))
      }
      if (
        (meetingInfo.audioOff.startsWith(AttendeeOffType.offNotAllowSelfOn) ||
          meetingInfo.audioOff.startsWith(AttendeeOffType.offAllowSelfOn)) &&
        meetingInfo.hostUuid !== meetingInfo.localMember.uuid &&
        options.audio === 1 &&
        !meetingInfo.localMember.hide &&
        !meetingInfo.inWaitingRoom
      ) {
        Toast.info(t('participantHostMuteAllAudio'))
      }
      // @ts-ignore
      neMeeting?.rtcController?.enableAudioVolumeIndication?.(true, 200)
      // 如果存在设置缓存则外部没有传入情况下使用设置选项
      if (setting) {
        const { normalSetting, audioSetting, videoSetting, beautySetting } =
          setting
        if (beautySetting && beautySetting.beautyLevel > 0) {
          const beautyLevel = beautySetting.beautyLevel
          // @ts-ignore
          neMeeting?.previewController?.startBeauty?.()
          // @ts-ignore
          neMeeting?.previewController?.enableBeauty?.(true)
          // @ts-ignore
          neMeeting?.previewController?.setBeautyEffect?.(
            NERoomBeautyEffectType.kNERoomBeautyWhiten,
            beautyLevel / 10
          )
          // @ts-ignore
          neMeeting?.previewController?.setBeautyEffect?.(
            NERoomBeautyEffectType.kNERoomBeautySmooth,
            (beautyLevel / 10) * 0.8
          )
          // @ts-ignore
          neMeeting?.previewController?.setBeautyEffect?.(
            NERoomBeautyEffectType.kNERoomBeautyFaceRuddy,
            beautyLevel / 10
          )
          // @ts-ignore
          neMeeting?.previewController?.setBeautyEffect?.(
            NERoomBeautyEffectType.kNERoomBeautyFaceSharpen,
            beautyLevel / 10
          )
          // @ts-ignore
          neMeeting?.previewController?.setBeautyEffect?.(
            NERoomBeautyEffectType.kNERoomBeautyThinFace,
            (beautyLevel / 10) * 0.8
          )
        }
        if (beautySetting && beautySetting.virtualBackgroundPath) {
          // @ts-ignore
          neMeeting?.previewController?.enableVirtualBackground?.(
            true,
            beautySetting.virtualBackgroundPath
          )
        }
        if (window.isElectronNative) {
          //@ts-ignore
          neMeeting?.rtcController?.adjustPlaybackSignalVolume(
            audioSetting.playouOutputtVolume !== undefined
              ? audioSetting.playouOutputtVolume
              : 25
          )
          audioSetting.recordOutputVolume !== undefined &&
            //@ts-ignore
            neMeeting?.previewController?.setRecordDeviceVolume(
              audioSetting.recordOutputVolume
            )
        } else {
          if (audioSetting.playouOutputtVolume !== undefined) {
            try {
              neMeeting?.rtcController?.adjustPlaybackSignalVolume(
                audioSetting.playouOutputtVolume
              )
            } catch (e) {}
          }
          if (audioSetting.recordOutputVolume !== undefined) {
            neMeeting?.rtcController?.adjustRecordingSignalVolume(
              audioSetting.recordOutputVolume
            )
          }
        }
        audioSetting.recordDeviceId &&
          neMeeting?.changeLocalAudio(audioSetting.recordDeviceId)
        audioSetting.playoutDeviceId &&
          neMeeting?.selectSpeakers(audioSetting.playoutDeviceId)
        videoSetting.deviceId &&
          neMeeting?.changeLocalVideo(videoSetting.deviceId)
        neMeeting?.setVideoProfile(videoSetting.resolution || 720)

        // 处理音频降噪回音立体音等
        if (audioSetting && window?.isElectronNative) {
          try {
            if (audioSetting.enableAudioAI) {
              // @ts-ignore
              neMeeting?.enableAudioAINS(true)
            } else {
              // @ts-ignore
              neMeeting?.enableAudioAINS(false)
              if (audioSetting.enableMusicMode) {
                neMeeting?.enableAudioEchoCancellation(
                  audioSetting.enableAudioEchoCancellation as boolean
                )
                if (audioSetting.enableAudioStereo) {
                  neMeeting?.setAudioProfileInEle(
                    tagNERoomRtcAudioProfileType.kNEAudioProfileHighQualityStereo,
                    tagNERoomRtcAudioScenarioType.kNEAudioScenarioMusic
                  )
                } else {
                  neMeeting?.setAudioProfileInEle(
                    tagNERoomRtcAudioProfileType.kNEAudioProfileHighQuality,
                    tagNERoomRtcAudioScenarioType.kNEAudioScenarioMusic
                  )
                }
              } else {
                neMeeting?.setAudioProfileInEle(
                  tagNERoomRtcAudioProfileType.kNEAudioProfileDefault,
                  tagNERoomRtcAudioScenarioType.kNEAudioScenarioDefault
                )
              }
            }
          } catch (e) {
            console.log('处理高级音频设置error', e)
          }
          try {
            // @ts-ignore
            neMeeting?.enableAudioVolumeAutoAdjust(
              audioSetting.enableAudioVolumeAutoAdjust
            )
          } catch (e) {
            console.log('处理是否自动调节麦克风音量error', e)
          }
        }

        // 如果data存在则是等候室进入
        if (data) {
          meeting.meetingInfo.isUnMutedVideo = data.isUnMutedVideo
          meeting.meetingInfo.isUnMutedAudio = data.isUnMutedAudio
        } else {
          meeting.meetingInfo.isUnMutedAudio =
            options.audio === undefined
              ? normalSetting.openAudio
              : options.audio === 1
          meeting.meetingInfo.isUnMutedVideo =
            options.video === undefined
              ? normalSetting.openVideo
              : options.video === 1
        }

        meeting.meetingInfo = {
          ...options,
          ...meeting.meetingInfo,
          enableFixedToolbar:
            options.enableFixedToolbar === undefined
              ? normalSetting.showToolbar
              : options.enableFixedToolbar !== false,
          enableVideoMirror:
            options.enableVideoMirror === undefined
              ? videoSetting.enableVideoMirroring
              : options.enableVideoMirror !== false,
          enableUnmuteBySpace:
            options.enableUnmuteBySpace === undefined
              ? audioSetting.enableUnmuteBySpace
              : options.enableUnmuteBySpace,
          showDurationTime:
            options.showDurationTime === undefined
              ? normalSetting.showDurationTime
              : options.showDurationTime,
          showSpeakerList:
            options.showSpeaker === undefined
              ? normalSetting.showSpeakerList
              : options.showSpeaker,
          enableTransparentWhiteboard:
            options.enableTransparentWhiteboard === undefined
              ? normalSetting.enableTransparentWhiteboard
              : options.enableTransparentWhiteboard,
        } as NEMeetingSDKInfo
      } else {
        if (data) {
          meeting.meetingInfo.isUnMutedVideo = data.isUnMutedVideo
          meeting.meetingInfo.isUnMutedAudio = data.isUnMutedAudio
        } else {
          meeting.meetingInfo.isUnMutedAudio = options.audio === 1
          meeting.meetingInfo.isUnMutedVideo = options.video === 1
        }
        meeting.meetingInfo = {
          ...options,
          ...meeting.meetingInfo,
          enableFixedToolbar: options.enableFixedToolbar !== false,
          enableVideoMirror: options.enableVideoMirror !== false,
        } as NEMeetingSDKInfo
      }
    }
    // if (window.isElectronNative) {
    //   window.ipcRenderer?.send(IPCEvent.changeMeetingStatus, true)
    // }
    if (meeting) {
      const meetingInfo = meeting.meetingInfo
      // 入会判断是正在录制，如果在录制则弹框提醒
      if (
        meetingInfo.isCloudRecording &&
        meetingInfo.localMember.role !== Role.host &&
        meetingInfo.localMember.role !== Role.coHost &&
        options.showCloudRecordingUI !== false &&
        !meetingInfo.inWaitingRoom
      ) {
        eventEmitter?.emit(MeetingEventType.needShowRecordTip, true)
      }
      // 存在如果两个端同时入会，本端入会成功获取到的成员列表可能还未有另外一个端。但是本端会有收到memberJoin事件
      if (memberList && memberList.length > 0) {
        memberList.forEach((member) => {
          const index = meeting.memberList.findIndex((m) => {
            return member.uuid == m.uuid
          })
          if (index < 0) {
            console.log('存在未同步>>', member)
            meeting.memberList.push(member)
          }
        })
      }
      // 获取初始化直播状态
      const liveInfo = neMeeting?.getLiveInfo()
      if (liveInfo) {
        meeting.meetingInfo.liveState = liveInfo.state
      }
      dispatch &&
        dispatch({
          type: ActionType.SET_MEETING,
          data: meeting,
        })
    }
    neMeeting?.getWaitingRoomInfo().then((res) => {
      if (!res) {
        return
      }
      neMeeting?.updateWaitingRoomUnReadCount(res.memberList.length)
      waitingRoomDispatch?.({
        type: ActionType.WAITING_ROOM_UPDATE_INFO,
        data: { info: res.waitingRoomInfo },
      })
      waitingRoomDispatch?.({
        type: ActionType.WAITING_ROOM_SET_MEMBER_LIST,
        data: { memberList: res.memberList },
      })
    })
  }

  // 加入失败
  const handleJoinFail = (
    err: { code: number | string; message: string; msg?: string },
    options?: JoinOptions,
    isRejoin?: boolean
  ) => {
    globalDispatch?.({
      type: ActionType.UPDATE_GLOBAL_CONFIG,
      data: {
        waitingRejoinMeeting: false,
        online: true,
      },
    })
    globalDispatch?.({
      type: ActionType.UPDATE_GLOBAL_CONFIG,
      data: {
        waitingJoinOtherMeeting: false,
      },
    })

    switch (err.code) {
      // 创建会议 会议已经存在
      case 3100:
        joinOptionRef.current = options
        eventEmitter?.emit(EventType.MeetingExits, {
          options: options,
          callback: callbackRef.current,
        })
        break
      case 3104:
      case 1004:
        Toast.info(err.message || (err.msg as string))
        hideLoadingPage()
        break
      case 1020:
        if (window.isElectronNative) {
          window.ipcRenderer?.send(IPCEvent.changeMeetingStatus, false)
        }
        passwordRef.current && setErrorText(t('meetingWrongPassword'))
        joinOptionRef.current = options
        // 会议状态回调：会议状态为等待，原因是需要输入密码
        outEventEmitter?.emit(
          UserEventType.onMeetingStatusChanged,
          NEMeetingStatus.MEETING_STATUS_WAITING,
          NEMeetingCode.MEETING_WAITING_VERIFY_PASSWORD
        )
        setPasswordDialogShow(true)
        break
      case 1019:
        Toast.info(t('meetingLockMeetingByHost'))
        hideLoadingPage()
        dispatch?.({
          type: ActionType.RESET_MEETING,
          data: null,
        })
        break
      // 会议已锁定、结束
      case 3102:
        Toast.info(
          errorCodeMap[err.code] || err.msg || err.message || 'join failed'
        )
        hideLoadingPage()
        dispatch?.({
          type: ActionType.RESET_MEETING,
          data: null,
        })
        break
      default:
        Toast.info(
          errorCodeMap[err.code] || err.msg || err.message || 'join failed'
        )
        if (!isRejoin) {
          outEventEmitter?.emit(
            UserEventType.onMeetingStatusChanged,
            NEMeetingStatus.MEETING_STATUS_FAILED
          )
        }

        hideLoadingPage()
        console.log(err, '加入失败')
    }
  }

  function updateGlobalConfig(options: {
    showSubject?: boolean
    globalConfig?: GetMeetingConfigResponse
    showMeetingRemainingTip?: boolean
    toolBarList?: ToolBarList
    moreBarList?: MoreBarList
    waitingJoinOtherMeeting?: boolean
  }) {
    globalDispatch &&
      globalDispatch({
        type: ActionType.UPDATE_GLOBAL_CONFIG,
        data: options,
      })
  }

  // 隐藏loading页面
  function hideLoadingPage() {
    globalDispatch &&
      globalDispatch({
        type: ActionType.JOIN_LOADING,
        data: false,
      })
    setPasswordDialogShow(false)
    // setPassword('')
    setErrorText('')
    // setIsAnonymousLogin(false)
    // passwordRef.current = ''
  }

  const joinMeeting = (
    options: JoinOptions,
    isJoinOther?: boolean,
    isRejoin?: boolean
  ): Promise<void> => {
    if (!options.meetingId && !options.meetingNum) {
      Toast.info('请输入会议号')
      throw new Error('meetingNum is empty')
    }
    joinOptionRef.current = options
    const joinMeetingReport = new IntervalEvent({
      eventId: StaticReportType.MeetingKit_join_meeting,
      priority: EventPriority.HIGH,
    })
    joinMeetingReport.addParams({
      type: 'normal',
      meetingNum: options.meetingNum,
    })
    globalDispatch &&
      globalDispatch({
        type: ActionType.JOIN_LOADING,
        data: true,
      })
    setIsAnonymousLogin(false)
    options.password = options.password || passwordRef.current
    const _neMeeting = neMeeting as NEMeetingService
    const joinFunc = isJoinOther
      ? _neMeeting.acceptInvite.bind(_neMeeting)
      : _neMeeting.join.bind(_neMeeting)
    return joinFunc({ ...options, joinMeetingReport })
      .then((res) => {
        try {
          joinMeetingReport.endWithSuccess()
          xkitReportRef.current?.reportEvent(joinMeetingReport)
        } catch (e) {}
        handleJoinSuccess(options)
      })
      .catch((err) => {
        if (
          err.data &&
          err.data.message?.includes('mediaDevices is not support')
        ) {
          Toast.info('mediaDevices is not support')
          try {
            joinMeetingReport.endWithSuccess()
            xkitReportRef.current?.reportEvent(joinMeetingReport)
          } catch (e) {}
          handleJoinSuccess(options)
          return Promise.resolve()
        }
        try {
          joinMeetingReport.endWith({
            code: err.code || -1,
            msg: err.msg || err.message || 'Failure',
          })
          xkitReportRef.current?.reportEvent(joinMeetingReport)
        } catch (e) {}
        handleJoinFail(err, options, isRejoin)
        return Promise.reject(err)
      })
  }

  const anonymousJoin = (options: JoinOptions, isRejoin?: boolean) => {
    if (!options.meetingId && !options.meetingNum) {
      Toast.info('请输入会议号')
      throw new Error('meetingId is empty')
    }
    const joinMeetingReport = new IntervalEvent({
      eventId: StaticReportType.MeetingKit_join_meeting,
      priority: EventPriority.HIGH,
    })
    try {
      joinMeetingReport.addParams({
        type: 'anonymous',
        meetingNum: options.meetingNum,
      })
    } catch (e) {}
    globalDispatch &&
      globalDispatch({
        type: ActionType.JOIN_LOADING,
        data: true,
      })
    joinOptionRef.current = options
    options.password = options.password || passwordRef.current
    setIsAnonymousLogin(true)
    return (neMeeting as NEMeetingService)
      .anonymousJoin({ ...options, joinMeetingReport })
      .then((res) => {
        if ([-101, -102].includes(res?.code)) {
          throw res
        }
        try {
          joinMeetingReport.endWithSuccess()
          xkitReportRef.current?.reportEvent(joinMeetingReport)
        } catch (e) {}
        handleJoinSuccess(options)
      })
      .catch((err) => {
        if (
          err.data &&
          (err.data.message?.includes('mediaDevices is not support') ||
            err.data.message?.includes('getDevices'))
        ) {
          Toast.info('mediaDevices is not support')
          try {
            joinMeetingReport.endWithSuccess()
            xkitReportRef.current?.reportEvent(joinMeetingReport)
          } catch (e) {}
          handleJoinSuccess(options)
          return Promise.resolve()
        }
        try {
          joinMeetingReport.endWith({
            code: err.code || -1,
            msg: err.msg || err.message || 'Failure',
          })
          xkitReportRef.current?.reportEvent(joinMeetingReport)
        } catch (e) {}
        handleJoinFail(err, options, isRejoin)
        return Promise.reject(err)
      })
  }

  // 密码入会
  function joinMeetingWithPsw() {
    if (!password.trim()) {
      setErrorText(t('meetingEnterPassword'))
      return
    }
    outEventEmitter?.emit(
      UserEventType.onMeetingStatusChanged,
      NEMeetingStatus.MEETING_STATUS_CONNECTING
    )
    const options = { ...joinOptionRef.current, password }
    joinOptionRef.current = options as JoinOptions
    if (isAnonymousLogin) {
      outEventEmitter?.emit(UserEventType.AnonymousJoinMeeting, {
        options,
        callback: callbackRef.current,
      })
    } else {
      outEventEmitter?.emit(UserEventType.JoinMeeting, {
        options,
        callback: callbackRef.current,
      })
    }
  }

  return (
    <>
      <Dialog
        visible={passwordDialogShow}
        title={t('meetingPassword')}
        width={320}
        confirmText={t('meetingJoin')}
        cancelText={t('globalCancel')}
        confirmClassName={`nemeeting-password-join ${
          !password || password.length < 6
            ? 'nemeeting-password-join-disabled'
            : ''
        }`}
        cancelClassName="nemeeting-password-join-cancel"
        onCancel={() => {
          outEventEmitter?.emit(
            UserEventType.onMeetingStatusChanged,
            NEMeetingStatus.MEETING_STATUS_IDLE
          )
          setPasswordDialogShow(false)
          setPassword('')
          passwordRef.current = ''
          hideLoadingPage()
        }}
        onConfirm={() => {
          if (window.isElectronNative) {
            window.ipcRenderer?.send(IPCEvent.changeMeetingStatus, true)
          }
          setPasswordDialogShow(false)
          if (isJoining) return
          joinMeetingWithPsw()
        }}
        confirmDisabled={!password || password.length < 6}
      >
        <div style={{ minHeight: 80, marginTop: 10, position: 'relative' }}>
          <input
            style={{
              border: errorText ? '1px solid red' : 'none',
              display: 'block',
            }}
            className={'input-ele'}
            placeholder={t('meetingEnterPassword')}
            maxLength={20}
            value={password.replace(/[^\d]/g, '').slice(0, 6)}
            required
            onChange={(e) => {
              let val = e.target.value
              val = val.replace(/[^\d]/g, '').slice(0, 6)
              setPassword(val)
              passwordRef.current = val
            }}
          />
          {password && password.length > 0 && (
            <svg
              className="icon nemeeting-close-icon"
              style={{
                position: 'absolute',
                right: '6px',
                top: '12px',
                fontSize: '12px',
                cursor: 'pointer',
              }}
              aria-hidden="true"
              onClick={() => {
                setPassword('')
                passwordRef.current = ''
              }}
            >
              <use xlinkHref="#iconyx-pc-closex"></use>
            </svg>
          )}
          {errorText ? (
            <div style={{ color: '#ff3141', marginTop: 10, fontSize: 12 }}>
              {errorText}
            </div>
          ) : (
            ''
          )}
        </div>
      </Dialog>
    </>
  )
}

export default Auth
